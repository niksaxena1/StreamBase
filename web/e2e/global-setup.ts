import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const statePath = path.join(process.cwd(), "e2e", ".auth", "state.json");

async function loadLocalEnv() {
  try {
    const source = await readFile(
      path.join(process.cwd(), ".env.local"),
      "utf8",
    );
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()])
        process.env[match[1].trim()] = match[2]
          .trim()
          .replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* CI may provide env directly */
  }
}

export default async function globalSetup(config: FullConfig) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await loadLocalEnv();
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
    await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: access } = await admin
    .from("app_user_access")
    .select("user_id")
    .eq("competitor", true)
    .limit(1)
    .maybeSingle();
  const { data: appAdmin } = access?.user_id
    ? { data: null }
    : await admin.from("app_admins").select("user_id").limit(1).maybeSingle();
  const targetUserId = access?.user_id ?? appAdmin?.user_id;
  if (!targetUserId)
    throw new Error(
      "No competitor-enabled or admin user is available for E2E verification",
    );
  let email: string | undefined;
  for (let page = 1; page <= 10 && !email; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    email = data.users.find((user) => user.id === targetUserId)?.email;
    if (data.users.length < 100) break;
  }
  if (!email)
    throw new Error("The competitor-enabled E2E user could not be resolved");
  const baseURL = String(
    config.projects[0]?.use?.baseURL ?? "http://localhost:3000",
  );
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: baseURL },
  });
  if (error || !data.properties?.action_link)
    throw error ?? new Error("Could not generate E2E sign-in link");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(data.properties.action_link);
  const hash = new URL(page.url()).hash.slice(1);
  const tokens = new URLSearchParams(hash);
  const accessToken = tokens.get("access_token");
  const refreshToken = tokens.get("refresh_token");
  if (!accessToken || !refreshToken)
    throw new Error("Magic-link verification did not return a session");
  const { data: userData, error: userError } =
    await admin.auth.getUser(accessToken);
  if (userError || !userData.user)
    throw userError ?? new Error("Could not resolve E2E session user");
  const expiresIn = Number(tokens.get("expires_in") ?? 3600);
  const session = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: Number(
      tokens.get("expires_at") ?? Math.floor(Date.now() / 1000) + expiresIn,
    ),
    token_type: "bearer",
    user: userData.user,
  });
  const encoded = `base64-${Buffer.from(session, "utf8").toString("base64url")}`;
  const ref = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  const chunks: Array<{
    name: string;
    value: string;
    url: string;
    sameSite: "Lax";
  }> = [];
  const encodedUri = encodeURIComponent(encoded);
  if (encodedUri.length <= 3180)
    chunks.push({
      name: cookieName,
      value: encoded,
      url: baseURL,
      sameSite: "Lax",
    });
  else {
    let rest = encodedUri;
    let index = 0;
    while (rest.length) {
      let head = rest.slice(0, 3180);
      const escape = head.lastIndexOf("%");
      if (escape > 3177) head = head.slice(0, escape);
      chunks.push({
        name: `${cookieName}.${index++}`,
        value: decodeURIComponent(head),
        url: baseURL,
        sameSite: "Lax",
      });
      rest = rest.slice(head.length);
    }
  }
  await context.addCookies(chunks);
  await page.goto(baseURL);
  await page.waitForURL(
    (target) =>
      target.origin === new URL(baseURL).origin &&
      !target.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );
  await context.storageState({ path: statePath });
  await browser.close();
}
