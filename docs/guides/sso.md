# Single sign-on

TMT Build Tracker can sign people in through any OpenID Connect (OIDC) provider, for example Authentik, Keycloak or Authelia. Only Authentik is written out step by step below; with another provider the same four values apply. (Not verified against any provider other than Authentik.)

Single sign-on needs `PUBLIC_URL` set to the https address of the app (see [Reverse proxy](reverse-proxy.md)), because the redirect address is built from it.

## Generic OIDC

Set all three of these on the container; together they switch SSO on and show the button on the sign-in and sign-up pages:

| Variable             | Value                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`        | The provider's issuer URL. The app reads `<OIDC_ISSUER>/.well-known/openid-configuration` to find the endpoints. |
| `OIDC_CLIENT_ID`     | Client ID from the provider.                                                                                     |
| `OIDC_CLIENT_SECRET` | Client secret from the provider.                                                                                 |
| `OIDC_PROVIDER_NAME` | Optional. Button label: "Sign in with NAME". Default `SSO`.                                                      |
| `PUBLIC_URL`         | `https://tmt.example.com` (no trailing slash).                                                                   |

Register this **redirect URI** with the provider: `<PUBLIC_URL>/api/auth/callback/oidc`, for example `https://tmt.example.com/api/auth/callback/oidc`. Ask for the scopes `openid`, `profile` and `email`.

If one of the three variables is empty the SSO button does not appear.

## Authentik

1. In Authentik: **Applications**, **Providers**, **Create**, **OAuth2/OpenID Provider**. Name `TMT Build Tracker`; Authorization flow of your choice (for example explicit consent); **Client type: Confidential**; **Redirect URIs/Origins (RegEx)**: `https://tmt.example.com/api/auth/callback/oidc` (escape the dots if your Authentik version treats it as a regular expression, or choose strict matching); signing key: your certificate (RS256); scopes: `openid`, `profile`, `email` (the default scope mappings). Save and note the **Client ID** and **Client Secret**.
2. **Applications**, **Create**: Name `TMT Build Tracker`, Slug `tmt`, Provider the one above. Optionally restrict who may use it with a policy or group binding.
3. The issuer is the **OpenID Configuration Issuer** on the provider's page, normally `https://auth.example.com/application/o/tmt/`. Check that `https://auth.example.com/application/o/tmt/.well-known/openid-configuration` opens in a browser.
4. In the container settings set:
   - `OIDC_ISSUER` = `https://auth.example.com/application/o/tmt/`
   - `OIDC_CLIENT_ID` = the client ID
   - `OIDC_CLIENT_SECRET` = the client secret
   - `OIDC_PROVIDER_NAME` = `Authentik` (the button reads "Sign in with Authentik")
   - `PUBLIC_URL` = `https://tmt.example.com`

   Apply (on Unraid: Docker tab, Edit, **Apply**). The sign-in and sign-up pages now show the SSO button.

5. Users are created on their first SSO login (name and email come from Authentik) and get their own "My builds" workspace. Password sign-up stays available alongside SSO. The first account of the install is the site admin whichever way it signs in; list your Authentik email in `ADMIN_EMAILS` to make an SSO user an admin.

The container itself fetches the issuer's discovery document, so it must be able to resolve and reach `auth.example.com` from inside Docker (on a LAN this usually works through your router or AdGuard DNS rewrite). If the SSO button shows but sign-in fails, check the container log.

## Who may sign up

`SIGNUP` controls who may create an email/password or SSO account on a self-hosted install:

- `open` (default): anyone who can reach the page.
- `invite`: needs an invitation link addressed to the person's email.
- `closed`: accepts nobody new.

`invite` and `closed` still allow the very first account on an empty database. It does not apply in public mode. Use `invite` or `closed` for any install reachable from the internet and whenever OIDC is used: with `open`, someone can register an address before its real owner and block that person's SSO login.

With SSO there is no app password to reset. For password accounts see [Backup and upgrade](backup-and-upgrade.md#forgotten-passwords).

## Google and GitHub (public mode)

This is for a hosted public instance (`TMT_MODE=public`), not for a home install. In public mode sign-in is only with Google and GitHub: no passwords, and the generic `OIDC_*` variables are refused. Emails must be verified by the provider, and printers and Spoolman are not available.

| Variable                                   | Meaning                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. A provider is on only when both variables of its pair are set; one without the other fails at start. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in, same rule.                                                                                           |

Register the redirect URIs `<PUBLIC_URL>/api/auth/callback/google` and `<PUBLIC_URL>/api/auth/callback/github`.

Public mode refuses to start unless `PUBLIC_URL` is an https origin on a real host name (no credentials, path, localhost or IP address), at least one of Google/GitHub is configured, `ADDRESS_HEADER` is set (trusted proxy) and `ADMIN_EMAILS` lists an admin. Any other `TMT_MODE` value fails at start. Public mode also has finite default limits; see the [environment reference](environment.md#limits).
