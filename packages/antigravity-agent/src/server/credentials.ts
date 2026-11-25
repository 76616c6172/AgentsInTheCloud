import { HttpRequestBlockedError, type SecretRequestTransform } from "@agents-in-the-cloud/proxy-egress/server";

export const antigravityAccessPlaceholder = "agents-in-the-cloud-antigravity-access";
export const antigravityCredentialHosts = ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com", "aicode.googleapis.com", "www.googleapis.com"];

export function antigravityWorkspaceCredential(): string {
  return JSON.stringify({
    token: { access_token: antigravityAccessPlaceholder, token_type: "Bearer", refresh_token: "", expiry: "2099-01-01T00:00:00Z" },
    auth_method: "consumer", id_token_email: "subscription@agents-in-the-cloud.local",
  });
}

export function antigravityCredentialTransform(accessToken: () => Promise<string>): SecretRequestTransform {
  return async (request, registerSecret) => {
    const containsMarker = (value: string) => value.includes(antigravityAccessPlaceholder);
    if (!containsMarker(request.url) && ![...request.headers.values()].some(containsMarker)) return request;
    const url = new URL(request.url);
    const userInfo = url.hostname !== "www.googleapis.com" || ["/oauth2/v2/userinfo", "/oauth2/v3/userinfo"].includes(url.pathname);
    if (url.protocol !== "https:" || url.port || !antigravityCredentialHosts.includes(url.hostname) || !userInfo || containsMarker(request.url)
      || request.headers.get("authorization") !== `Bearer ${antigravityAccessPlaceholder}`
      || [...request.headers].some(([name, value]) => name !== "authorization" && containsMarker(value))) {
      throw new HttpRequestBlockedError("Antigravity credentials are only available to its Google endpoints.");
    }
    const token = await accessToken();
    registerSecret(token);
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${token}`);
    return new Request(request, { headers });
  };
}
