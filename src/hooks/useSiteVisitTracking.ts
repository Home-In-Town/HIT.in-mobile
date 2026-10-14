// useSiteVisitTracking — the site-visit auto check-in engine.
//
// Watches the phone's location while a scheduled site visit is in progress and
// turns "the agent is standing at the project" into two persisted, visible
// events: an arrival and, after a dwell, a completion. The server owns both
// records (POST /site-visits/:id/arrive, /complete) and posts the typed
// `site_visit` group card; this hook only decides WHEN to call them.
//
// Ported from the collaborator's version, which inlined the same idea directly
// inside GroupChatEmbedded.tsx (already 8300 lines) with six defects. Each one
// is named at the line that fixes it. The maths and thresholds are theirs and
// are sound; the lifecycle around them was not.
//
// Nothing here is written to on-device key-value storage — on purpose. The
// collaborator kept the arrival timestamp and the whole visit list there, which
// made one phone the source of truth for a record the whole team reads. Here the
// server is authoritative and the only local state is in-memory: if the app is
// killed mid-visit, tracking simply stops (it is foreground-only, and the UI
// says so) and the server keeps whatever state it had already reached.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { siteVisitsApi, projectsApiExtended } from '../lib/api';
import { useToast } from '../components/Toast';

// ── Thresholds ──────────────────────────────────────────────
// These four values come from the collaborator's version and are kept as-is —
// they are reasonable for an Indian site visit on a mid-range Android. Only
// their form was wrong: they were inline literals (`<= 100`, `5 * 60 * 1000`,
// `timeInterval: 30000`) buried in three different functions, so the UI could
// not quote them and nobody could retune them in one place. Exported so the
// copy on screen says the same number the engine enforces.

/** Within this many metres of the project counts as "at the site". */
export const GEOFENCE_RADIUS_M = 100;
/** Stay inside the geofence this long and the visit is treated as done. */
export const DWELL_MS = 5 * 60 * 1000;
/** watchPositionAsync timeInterval — how often a fix is requested. */
export const SAMPLE_INTERVAL_MS = 30 * 1000;
/** watchPositionAsync distanceInterval — or sooner, if the phone moves this far. */
export const SAMPLE_DISTANCE_M = 50;

/** Earth's mean radius in metres, for the Haversine below. */
const EARTH_RADIUS_M = 6371e3;
const MS_PER_SECOND = 1000;

/**
 * Great-circle distance between two coordinates, in metres (Haversine).
 *
 * This is the collaborator's `getDistance`, correct as written and reused
 * unchanged. Their identifiers were mangled Greek (`φ1`, `Δφ`, `Δλ`) that had
 * already been corrupted once by an encoding round-trip in the file we received;
 * renaming them to ASCII is an encoding fix only, not a behaviour change.
 */
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * 'locating'  — permission granted, visit created, target being resolved.
 * 'watching'  — the watcher is live and the agent is outside the geofence.
 * 'arrived'   — arrival has been recorded server-side; the dwell clock is running.
 * 'completed' — completion has been recorded; the watcher is gone.
 */
export type SiteVisitPhase = 'locating' | 'watching' | 'arrived' | 'completed';

export interface SiteVisitTrackingState {
  visitId: string;
  leadId: string;
  leadName: string;
  projectName: string;
  phase: SiteVisitPhase;
  /** Metres to the project on the last fix. null until the first fix lands. */
  distanceMeters: number | null;
  /** Set and surfaced on every failure — nothing here fails silently. */
  error: string | null;
}

export interface StartSiteVisitInput {
  leadId: string;
  leadName: string;
  projectId: string;
  projectName: string;
}

/**
 * The live session. Held in a ref rather than state because `onFix` runs from
 * expo-location's callback, outside React's render cycle — reading the target
 * from state there is exactly the stale-closure trap that would read `null`
 * forever. `target` starts null and is filled in before the watcher starts.
 */
interface TrackingSession {
  visitId: string;
  leadId: string;
  leadName: string;
  projectName: string;
  target: { latitude: number; longitude: number } | null;
}

export function useSiteVisitTracking() {
  const toast = useToast();

  const [state, setState] = useState<SiteVisitTrackingState | null>(null);
  /**
   * Whether a session is live, as a separate flag rather than something derived
   * from `state`. The two genuinely differ: a terminal state (completed, or a
   * failed start) stays on screen after the session has ended, and an arrival
   * that failed to post leaves an error in `state` while the watcher is still
   * running and will retry. Deriving this from `state` got one of those two
   * cases wrong whichever way it was written.
   */
  const [live, setLive] = useState(false);

  const trackingRef = useRef<TrackingSession | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);
  /** Start of the current uninterrupted stay inside the geofence, in ms. */
  const arrivalRef = useRef<number | null>(null);
  /** DEFECT 6 guard — arrive() is posted exactly once per session. */
  const arrivalPostedRef = useRef(false);
  /** DEFECT 4 guard — complete() is posted exactly once per session. */
  const completingRef = useRef(false);
  /**
   * Mirror of `state` for the same reason `trackingRef` exists: the guards in
   * `onFix` / `finish` run from a location callback and must see the value as of
   * now, not as of the render that created the closure.
   */
  const stateRef = useRef<SiteVisitTrackingState | null>(null);

  const publish = useCallback((next: SiteVisitTrackingState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patch = useCallback((changes: Partial<SiteVisitTrackingState>) => {
    const current = stateRef.current;
    if (!current) return;
    publish({ ...current, ...changes });
  }, [publish]);

  /**
   * DEFECT 2 — the watch subscription is removed here and nowhere else.
   * The collaborator stored the subscription in a ref and only removed it on a
   * successful completion, so a cancelled visit, a failed completion or simply
   * navigating away left a GPS watcher running for the rest of the process's
   * life. `teardown` is called by `finish`, by `stop`, and by the unmount
   * cleanup below, so every exit path releases it.
   */
  const teardown = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
    trackingRef.current = null;
    arrivalRef.current = null;
    arrivalPostedRef.current = false;
    completingRef.current = false;
    setLive(false);
  }, []);

  /**
   * Ends the session AND clears what is on screen — this is the user's
   * Stop / Dismiss, and the unmount cleanup. `finish` deliberately does not
   * call it: a completed visit calls `teardown` instead, so its outcome stays
   * visible until the user dismisses it or starts another check-in.
   */
  const stop = useCallback(() => {
    teardown();
    publish(null);
  }, [publish, teardown]);

  /**
   * DEFECT 4 — the collaborator's `checkSiteVisitDuration` called
   * `completeSiteVisit` on EVERY callback once the dwell had elapsed, with no
   * re-entry guard and no terminal check, so a visit posted a duplicate
   * completion message every 30 seconds for as long as the agent stayed on site.
   * `completingRef` closes that here; the server's /complete is idempotent too
   * (it returns the stored visit with posted:false), so even a buggy client
   * cannot produce a second card.
   */
  const finish = useCallback(async (coords: { latitude: number; longitude: number }, dwellSeconds: number) => {
    if (completingRef.current || stateRef.current?.phase === 'completed') return;
    const session = trackingRef.current;
    if (!session) return;
    completingRef.current = true;

    try {
      await siteVisitsApi.complete(session.visitId, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        dwellSeconds,
      });
      patch({ phase: 'completed', error: null });
      toast.success('Site visit completed');
    } catch (e: any) {
      // The arrival is already recorded server-side, so nothing is lost: the
      // honest move is to surface the failure and end the session rather than
      // retry on a timer and toast every 30 seconds. Starting check-in again
      // resumes this same visit — the server returns the existing non-terminal
      // document instead of creating a second one.
      patch({ error: e?.message || 'Could not record the completed visit' });
      toast.error(e?.message || 'Could not record the completed visit');
    }
    teardown();
  }, [patch, teardown, toast]);

  const onFix = useCallback(async (fix: Location.LocationObject) => {
    const session = trackingRef.current;
    if (!session || !session.target) return;

    const distance = getDistanceMeters(
      fix.coords.latitude,
      fix.coords.longitude,
      session.target.latitude,
      session.target.longitude,
    );
    // Published on every fix so the UI can say "120 m away" instead of an
    // opaque spinner. Rounded because sub-metre precision is noise at this zoom.
    patch({ distanceMeters: Math.round(distance) });

    if (distance > GEOFENCE_RADIUS_M) {
      // Leaving the geofence restarts the dwell clock but deliberately KEEPS the
      // recorded arrival — that is the whole point of defect 6. A five-minute
      // look around that ends early is still a visit that happened.
      arrivalRef.current = null;
      return;
    }

    if (arrivalRef.current === null) arrivalRef.current = Date.now();

    // DEFECT 6 — arrival is its own persisted, visible event. The collaborator
    // wrote the arrival timestamp into on-device storage and surfaced nothing, so a
    // visit shorter than the dwell left no trace at all and the team could not
    // see that the agent had turned up. The ref is set BEFORE the await so a
    // second fix arriving while the request is in flight cannot post twice.
    if (!arrivalPostedRef.current) {
      arrivalPostedRef.current = true;
      try {
        await siteVisitsApi.arrive(session.visitId, {
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracy: fix.coords.accuracy ?? undefined,
          distanceMeters: Math.round(distance),
        });
        patch({ phase: 'arrived', error: null });
      } catch (e: any) {
        // Cleared so the next fix retries: unlike completion, an unrecorded
        // arrival has no server-side trace to fall back on, and the agent is
        // standing there either way.
        arrivalPostedRef.current = false;
        patch({ error: e?.message || 'Could not record arrival' });
        toast.error(e?.message || 'Could not record arrival');
        return;
      }
    }

    const elapsed = Date.now() - (arrivalRef.current ?? Date.now());
    if (elapsed >= DWELL_MS) {
      await finish(fix.coords, Math.round(elapsed / MS_PER_SECOND));
    }
  }, [finish, patch, toast]);

  const start = useCallback(async (input: StartSiteVisitInput): Promise<boolean> => {
    // DEFECT 3 — exactly ONE tracked visit at a time, and refused out loud.
    // This is a design choice, not a limitation: watchPositionAsync is a
    // foreground watcher on one phone carried by one person, who can only be at
    // one site at a time. A keyed map of sessions would model simultaneity that
    // cannot physically occur and would double the state that can leak. The
    // collaborator had the same single ref but overwrote it silently, so
    // starting a second visit abandoned the first one's watcher and tracking.
    const existing = trackingRef.current;
    if (existing) {
      toast.show(`Already tracking ${existing.leadName}'s visit`);
      return false;
    }

    // Claimed synchronously, before any await, so a double tap cannot slip a
    // second session past the check above while the first is still setting up.
    const session: TrackingSession = {
      visitId: '',
      leadId: input.leadId,
      leadName: input.leadName,
      projectName: input.projectName,
      target: null,
    };
    trackingRef.current = session;
    setLive(true);
    publish({
      visitId: '',
      leadId: input.leadId,
      leadName: input.leadName,
      projectName: input.projectName,
      phase: 'locating',
      distanceMeters: null,
      error: null,
    });

    // DEFECT 1 — the FOREGROUND permission only. expo-location's background
    // equivalent is deliberately never called anywhere in this file: the
    // collaborator asked the user for background location and then never used
    // it. watchPositionAsync is foreground-only, Google requires a written
    // justification and a manual review for ACCESS_BACKGROUND_LOCATION, and
    // prompting for a permission the code does not exercise is a dark pattern as
    // well as a store-rejection risk. A real background implementation needs
    // expo-task-manager and is a deliberate follow-up, not something to fake
    // with a permission dialog. The UI says tracking works while the app is open.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      const message = 'Location permission is needed to check in at the site';
      patch({ error: message });
      teardown();
      toast.error(message);
      return false;
    }

    // DEFECT 5 — resolve the target BEFORE starting the watcher, and say why if
    // it cannot be resolved. The collaborator wrapped getById in a try/catch
    // whose only body was a debug log reading "Could not fetch project
    // location", then started the watcher anyway: `targetLocation` stayed null,
    // so every single fix hit `if (!targetLocation) return;` and the phone burned battery
    // on a GPS watcher that could never check anyone in, with nothing on screen
    // to say so. (The same unhandled getById failure is what used to leave the
    // property drawer empty.) Here a failure sets the error, toasts the ACTUAL
    // reason, and returns without ever calling watchPositionAsync.
    let visitId: string;
    let target: { latitude: number; longitude: number };
    try {
      const { visit } = await siteVisitsApi.create({ leadId: input.leadId, projectId: input.projectId });
      visitId = visit.id;

      const project = await projectsApiExtended.getById(input.projectId);
      if (typeof project.latitude !== 'number' || typeof project.longitude !== 'number') {
        const message = 'Project location is not set — add it in the dashboard';
        patch({ error: message });
        teardown();
        toast.error(message);
        return false;
      }
      target = { latitude: project.latitude, longitude: project.longitude };
    } catch (e: any) {
      const message = e?.message || 'Could not load the project';
      patch({ error: message });
      teardown();
      toast.error(message);
      return false;
    }

    // Filled in before the watcher exists, so the very first fix already has a
    // target to measure against instead of being discarded.
    session.visitId = visitId;
    session.target = target;

    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: SAMPLE_INTERVAL_MS,
          distanceInterval: SAMPLE_DISTANCE_M,
        },
        onFix,
      );
      // stop() (or an unmount) can land while the watcher is still being
      // created. Without this the fresh subscription would outlive the session
      // that asked for it — the same leak as defect 2, just through a narrower
      // door.
      if (trackingRef.current !== session) {
        subscription.remove();
        return false;
      }
      subRef.current = subscription;
    } catch (e: any) {
      const message = e?.message || 'Could not start location tracking';
      patch({ error: message });
      teardown();
      toast.error(message);
      return false;
    }

    patch({ visitId, phase: 'watching' });
    return true;
  }, [onFix, patch, publish, teardown, toast]);

  // DEFECT 2 — an unmount always releases a live watcher. The collaborator's
  // cleanup effect removed `locationWatchId.current` but their completion path
  // was the only thing that ever set it back to null, so the two could disagree.
  // Here teardown is the single place that touches the subscription.
  useEffect(() => () => { teardown(); }, [teardown]);

  return {
    /**
     * True while a session is live — setting up, watching or dwelling. False
     * again the moment it ends, including while a completed or failed session is
     * still shown on screen, so the UI can offer "Start check-in" elsewhere
     * without stepping on the one-visit-at-a-time rule.
     */
    tracking: live,
    start,
    stop,
    state,
  };
}
