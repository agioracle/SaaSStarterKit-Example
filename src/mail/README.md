# Email templates and local previews

`npm run email:dev` starts React Email at `http://localhost:3001` and scans
`src/mail/templates` directly. Its pre-command generates Paraglide messages first,
so an npm-ci-only checkout does not need a full application build. The pinned `@react-email/ui` development dependency
must match `react-email`. Previewing does not send an email or require provider
credentials. Do not configure a Resend key or use the preview app's send action
for a local visual check.

## Add a template once

Create a `.tsx` file in `src/mail/templates` with a default-exported component
and safe `PreviewProps`:

```tsx
// src/mail/templates/my-custom-email.tsx
import { Text } from "react-email";
import EmailLayout from "../components/email-layout";
import EmailButton from "../components/email-button";

type Props = { username: string; actionUrl: string };

export default function MyCustomEmail({ username, actionUrl }: Props) {
  return (
    <EmailLayout title="Welcome">
      <Text>Hello {username},</Text>
      <EmailButton href={actionUrl}>Get started</EmailButton>
    </EmailLayout>
  );
}

MyCustomEmail.PreviewProps = {
  username: "Preview Reader",
  actionUrl: "https://example.invalid/preview-only",
} satisfies Props;
```

The file appears in the preview list automatically. No separate `emails/` wrapper
or preview registry is required. Use invented names, `example.invalid` addresses
and links, and no real users, tokens, verification links or provider credentials.
`PreviewProps` are preview fixtures, not default values for runtime delivery.

To send the template through the typed application API, separately:

1. Add its name to the `EmailTemplate` union in `src/mail/types.ts`. Optionally
   add its context to `EmailTemplateContexts` for stronger type checking (module
   augmentation of that interface also adds the template name automatically).
2. Import the same default component in `src/mail/render.ts`, then register it in
   `EmailTemplates` and add its subject to `EmailSubjects`.
3. Validate custom context before rendering or sending. Built-in validation does
   not automatically validate new template-specific fields.

The preview scans `.js`, `.jsx` and `.tsx` files with a recognized default export.
Keep shared components in `src/mail/components`, outside the scanned directory.
Keep the named-export compatibility barrel as `templates/index.ts`, not `.tsx`:
React Email also recognizes default re-exports, so a `.tsx` barrel can appear as
an invalid preview. Existing imports from `src/mail/templates` still resolve to
the exact canonical components used by the runtime registry.

The previous `emails/*.tsx` preview-only wrappers have been removed. Move any
custom wrappers' safe sample values to the canonical component's `PreviewProps`,
and keep the actual component in `src/mail/templates` with a default export.

References: [TanStarter email extension workflow](https://docs.tanstarter.dev/email/)
and [React Email CLI discovery and PreviewProps](https://react.email/docs/cli).

## Optional HTTP smoke test

After `npm ci` and `npm run locale:compile`, run
`python3 tests/manual/mail-preview-smoke.py` from the checkout
(macOS/Linux, Python 3 standard library; no extra dependencies). Use
`--source /path/to/checkout` to test an extracted archive instead. The helper
starts the installed CLI against an isolated public-source fixture, verifies all
five built-ins and discovery of a newly added custom template, then stops the
server. It disables telemetry, uses an empty home/config and an environment
allowlist, forces loopback listeners, blocks non-loopback network connections,
and never uses a browser or send action. It prints and retains its temporary
HTTP evidence directory. This is not visual QA or proof of live email delivery.
