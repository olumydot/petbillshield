import { API } from "../lib/api";

export async function getPetTimeline(petId) {
  const response = await fetch(`${API}/pets/${petId}/timeline`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to load pet timeline");
  }

  return await response.json();
}
