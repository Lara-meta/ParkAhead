export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch("/api/" + path, {
    cache: "no-store",
    ...(body !== undefined
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(json.error?.message ?? "Unable to complete request.");
  return json.data;
}
