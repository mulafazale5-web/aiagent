export async function apiFetch(
  endpointName: 'health' | 'chat' | 'tts' | 'voice-turn',
  init?: RequestInit
): Promise<Response> {
  const primaryUrl = `/api/${endpointName}`;
  const response = await fetch(primaryUrl, init);

  if (response.status === 404) {
    return fetch(`/.netlify/functions/${endpointName}`, init);
  }

  return response;
}
