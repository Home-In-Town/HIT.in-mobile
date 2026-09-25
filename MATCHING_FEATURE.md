# Matching Feature Implementation

## Overview
The Matching feature allows users to tap the "Matching" floating action button (FAB) to find properties that match their requirements collected through the AI Lead Assist conversation.

## Components Modified

### 1. **GroupChatEmbedded.tsx**
   - Added floating action buttons (FABs) for "My Post" and "Matching"
   - Implemented `doMatching()` function to fetch matching properties
   - Added matching results modal UI with:
     - Property name and location
     - Match score with color-coded badge (green ≥70%, amber ≥50%, gray <50%)
     - Property details (BHK, price)
     - Matched criteria tags
     - Owner information

### 2. **AiAssistant.tsx**
   - Added `getCurrentParams()` method to AiAssistantApi interface
   - Returns the currently collected requirement parameters (bhkType, budget, location, city, etc.)
   - Exposed via the API so external components can access collected data

### 3. **api.ts**
   - Added `testMatch(text)` - Test endpoint for NLP extraction + matching
   - Added `matchRequirement(params)` - Converts AI params to search query and fetches matches

## User Flow

1. User chats with AI Lead Assist and provides their requirement (e.g., "2BHK near Besa, 60L budget")
2. AI collects parameters: bhkType, budget, location, city, propertyType, etc.
3. User taps the **"Matching"** floating button (bottom-right of screen)
4. App calls `doMatching()` which:
   - Gets current params from AI via `getCurrentParams()`
   - Calls `leadMatchingApi.matchRequirement(params)`
   - Backend converts params to search text and runs NLP matching
5. Modal displays matching properties with:
   - Match scores
   - Property details
   - Matched criteria
   - Owner info

## API Endpoints Used

### POST `/api/lead-matching/test-match`
**Request:**
```json
{
  "text": "2BHK near Besa Nagpur 60 lakh budget"
}
```

**Response:**
```json
{
  "detected": true,
  "extraction": { "intent": "requirement", "params": { ... } },
  "matches": [
    {
      "project": {
        "_id": "...",
        "projectName": "...",
        "city": "...",
        "location": "...",
        "pricing": { "startingPrice": 6000000 },
        "configuration": { "bhkOptions": ["2BHK", "3BHK"] },
        "owner": { "name": "...", "companyName": "..." }
      },
      "score": 85,
      "confidence": 0.9,
      "matchedOn": ["BHK", "Location", "Budget"],
      "breakdown": { ... }
    }
  ],
  "matchCount": 5
}
```

## UI Components

### Floating Action Buttons (FABs)
- **Position:** Bottom-right corner, 80px from bottom (above input area)
- **Styling:** 
  - Elevated with shadows
  - "My Post": Green background (#F0FDF4)
  - "Matching": Brand color background
  - Icon + text labels
  - z-index: 100 (floats above all content)

### Matching Results Modal
- **Header:** Search icon + "Matching Properties" + close button
- **Loading State:** Spinner with "Finding matching properties..." text
- **Error State:** Error message with suggestion
- **Results:** Scrollable list of property cards
- **Empty State:** "No properties matched" message

### Property Card
- **Header Row:** Project name + match score badge
- **Location:** Icon + location text
- **Details Row:** BHK chips + price chip
- **Matched Criteria:** Tags showing what matched (BHK, Location, Budget, etc.)
- **Owner Info:** Builder name + company

## Styling

### Match Score Colors
- **Green (≥70%)**: Excellent match - `colors.greenText`
- **Amber (≥50%)**: Good match - `colors.amberText`  
- **Gray (<50%)**: Weak match - `colors.muted2`

### Card Styling
```typescript
mts.card: {
  backgroundColor: colors.white,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: colors.line,
  padding: 14,
  marginHorizontal: 16,
  marginTop: 12,
  gap: 10,
}
```

## Error Handling

1. **No params collected:** Shows toast "Please complete your requirement first"
2. **No matches found:** Shows "No matching properties found for your requirement"
3. **API error:** Shows error message with fallback "Failed to find matches"

## Future Enhancements

1. **Tap to view full property details** - Open property detail page on card tap
2. **Filter/sort results** - By score, price, distance
3. **Save searches** - Remember past requirements and matches
4. **Share matches** - Send match results to contacts
5. **Property images** - Show thumbnail in each card
6. **Map view** - Display properties on map
7. **Compare properties** - Side-by-side comparison
8. **Interest button** - Express interest directly from match card

## Testing Checklist

- [ ] FABs appear only in AI Lead Matching section
- [ ] FABs don't overlap input area or messages
- [ ] Matching button disabled/shows toast when no params
- [ ] Loading spinner appears while fetching
- [ ] Match scores display with correct colors
- [ ] Property details render correctly
- [ ] Matched criteria tags show relevant fields
- [ ] Modal scrolls smoothly with many results
- [ ] Close button works
- [ ] Error states display properly
- [ ] Empty state shows helpful message

## Build Requirements

The changes require a full rebuild:
```bash
cd android
./gradlew assembleRelease
```

Then install on device:
```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```
