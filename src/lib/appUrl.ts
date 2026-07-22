const ABSOLUTE_URL_RE = /^[A-Za-z][A-Za-z\d+.-]*:/;

export function resolveAppAssetUrl(url: string, base = import.meta.env.BASE_URL): string {
  if (ABSOLUTE_URL_RE.test(url) || url.startsWith("//")) {
    return url;
  }

  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${url.replace(/^\/+/, "")}`;
}
