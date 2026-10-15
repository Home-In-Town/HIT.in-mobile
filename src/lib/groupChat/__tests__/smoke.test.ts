// Throwaway spec that only proves the runner wires up: jest collects this path,
// babel-jest transforms TS through babel-preset-expo, and @types/jest supplies the
// globals so tsc --noEmit stays clean. HIT_Mobile had no test runner at all before
// this, so there was nothing to gate the GroupChatEmbedded extraction on.
// FEAT-003 deletes this file once real tests exist.
it('runs the test runner', () => {
  expect(1 + 1).toBe(2);
});
