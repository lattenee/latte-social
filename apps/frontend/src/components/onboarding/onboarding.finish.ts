// Persists workspace-scoped onboarding completion before the modal closes.
// customFetch resolves with the raw Response for non-2xx replies too (it
// only rejects on network failure), so the caller must check `ok` - treating
// a rejected save as success would close the modal without persisting
// anything and onboarding would reappear on the next login.
export const persistOnboardingComplete = async (
  fetch: (url: string, options?: RequestInit) => Promise<Response>,
  mutate: (key: string) => Promise<unknown>
) => {
  const response = await fetch('/user/onboarding/complete', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Could not save onboarding progress (${response.status})`);
  }
  // `/user/self` is the SWR key that feeds UserContext (see
  // new-layout/layout.component.tsx) - revalidate it so the persisted
  // onboardedAt actually reaches the context that gates future loads.
  await mutate('/user/self');
};
