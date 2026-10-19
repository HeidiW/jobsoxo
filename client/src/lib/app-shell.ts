export function isRouteActive(location: string, route: string): boolean {
  if (route === "/") return location === "/";
  return location === route || location.startsWith(`${route}/`);
}

export function legacyInboxDestination(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set("view", pathname.startsWith("/gmail-todos") ? "gmail" : "business");
  const query = params.toString();
  return `/inbox${query ? `?${query}` : ""}`;
}

export function hasWorksheetAccess(isAdmin: boolean): boolean {
  return isAdmin;
}
