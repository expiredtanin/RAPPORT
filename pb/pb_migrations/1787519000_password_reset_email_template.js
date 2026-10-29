/// <reference path="../pb_data/types.d.ts" />
// PocketBases Default-Mailtemplate für Passwort-Reset verlinkt auf
// "{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" — das ist die PocketBase-
// eigene Admin-UI-Route unter /_/, die für die "users"-Collection (normale
// RAPPORT-Accounts, keine Superuser) gar nicht existiert. Der Link muss
// stattdessen auf die RAPPORT-Frontend-Route zeigen, die App.jsx per Hash
// erkennt (siehe App.jsx "passwordRecovery"-State).
//
// {APP_URL} wird von PocketBase selbst aus der globalen Einstellung
// meta.appURL eingesetzt — die ist NICHT Teil dieser Migration, weil sie pro
// Deployment unterschiedlich ist (LAN-IP, eigene Domain, …). Sie wird beim
// Container-Start aus der Env-Var APP_URL gesetzt, siehe
// SERVER-CONTAINER/Dockerfile.pb (Entrypoint). Ohne gesetzte meta.appURL
// bleibt der Platzhalter leer und der Reset-Link ist nicht klickbar nutzbar —
// betrifft nur Deployments, die APP_URL nicht konfiguriert haben.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.resetPasswordTemplate.subject = "Passwort zurücksetzen — RAPPORT";
  users.resetPasswordTemplate.body = `
    <p>Hallo,</p>
    <p>Klicken Sie auf den folgenden Link, um Ihr RAPPORT-Passwort zurückzusetzen:</p>
    <p>
      <a class="btn" href="{APP_URL}/#/reset-password/{TOKEN}" target="_blank" rel="noopener">Passwort zurücksetzen</a>
    </p>
    <p><i>Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — es passiert nichts weiter.</i></p>
  `;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.resetPasswordTemplate.subject = "Reset your {APP_NAME} password";
  users.resetPasswordTemplate.body = `
    <p>Hello,</p>
    <p>Click on the button below to reset your password.</p>
    <p>
      <a class="btn" href="{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" target="_blank" rel="noopener">Reset password</a>
    </p>
    <p><i>If you didn't ask to reset your password, you can ignore this email.</i></p>
  `;
  app.save(users);
});
