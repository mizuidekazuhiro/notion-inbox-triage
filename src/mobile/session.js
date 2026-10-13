// Persistent first-party session for the Notion Flow web app.
// The user's long-lived X-Shortcut-Token remains only on the server after login.
// Sessions are HMAC-signed, HttpOnly, Secure and SameSite=Strict.
export const SESSION_COOKIE = "__Host-nf_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const RENEW_BEFORE_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function bytesFromHex(value) {
  if (value.length%2!==0||!/^[0-9a-f]+$/.test(value)) return null;
  const bytes = new Uint8Array(value.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(value.slice(i*2,i*2+2),16);
  return bytes;
}
function secretReady(env) {
  return Boolean(env?.ACTION_SECRET&&env?.SHORTCUT_TOKEN);
}
async function signingKey(env) {
  return crypto.subtle.importKey("raw",encoder.encode(env.ACTION_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
function message(env,expiration,nonce) {
  // Also bind signatures to the current Shortcut token so rotating it revokes sessions.
  return encoder.encode("notion-flow-session-v1|"+expiration+"|"+nonce+"|"+env.SHORTCUT_TOKEN);
}
export function readSessionCookie(request) {
  const raw=request.headers.get("Cookie")||"";
  for(const part of raw.split(";")) {
    const pos=part.indexOf("=");
    if(pos===-1)continue;
    if(part.slice(0,pos).trim()===SESSION_COOKIE)return part.slice(pos+1).trim();
  }
  return null;
}
export async function verifySession(request,env,now=Date.now()) {
  if(!secretReady(env))return null;
  const raw=readSessionCookie(request);
  if(!raw||raw.length>250)return null;
  const parts=raw.split(".");
  if(parts.length!==4||parts[0]!=="v1"||!/^[0-9]{10,12}$/.test(parts[1])||
    !/^[0-9a-f]{32}$/.test(parts[2])||!/^[0-9a-f]{64}$/.test(parts[3]))return null;
  const exp=Number(parts[1]);
  const sec=Math.floor(now/1000);
  if(!Number.isSafeInteger(exp)||exp<=sec||exp>sec+SESSION_TTL_SECONDS+60)return null;
  const signature=bytesFromHex(parts[3]);
  const key=await signingKey(env);
  const verified=await crypto.subtle.verify("HMAC",key,signature,message(env,exp,parts[2]));
  return verified?{expiresAt:exp,remaining:exp-sec}:null;
}
export async function mintSessionCookie(env,now=Date.now()) {
  if(!secretReady(env))throw new Error("session_configuration_missing");
  const exp=Math.floor(now/1000)+SESSION_TTL_SECONDS;
  const nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
  const key=await signingKey(env);
  const signature=hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,message(env,exp,nonce))));
  return SESSION_COOKIE+"=v1."+exp+"."+nonce+"."+signature+
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+SESSION_TTL_SECONDS;
}
export function clearSessionCookie() {
  return SESSION_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
