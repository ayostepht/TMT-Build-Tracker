# Install on your phone

TMT Build Tracker is a progressive web app: you can put it on your home screen and open it like an app (full screen, its own icon). It needs no app store.

- **iPhone / iPad (Safari):** open your instance, tap **Share**, then **Add to Home Screen**, then **Add**. Safari works on every iOS version; newer iOS versions also allow it from other browsers.
- **Android (Chrome):** open your instance, open the **three-dot menu**, then **Install app** (or **Add to Home screen**).
- **Desktop (Chrome, Edge):** use the install icon in the address bar.

**https matters.** Browsers only run the offline support and the "A new version is available" prompt on **https** addresses (and on `localhost`). Behind a reverse proxy with a certificate (see [Reverse proxy](reverse-proxy.md)) you get both. On a plain `http://<server-ip>:8420` address everything works as a normal web page and can still be added to the home screen as a shortcut, but there is no offline page and no update prompt.

What offline means here: the app shell, fonts and 3D models load from the phone, and if you are offline when you open the app you see a short "You are offline" page with a Retry button. **Your data is never cached or edited offline**: builds, plates and progress always come from the server, and a change you make while offline is not saved. When a new version is deployed, the app shows a small "A new version is available" message with a Reload button; it never reloads by itself mid-edit.
