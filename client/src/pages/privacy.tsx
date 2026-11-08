import { Link } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";

const COMPANY = "JobsOxo";
const APP_URL = "https://jobsoxo.onrender.com";
const CONTACT_EMAIL = "heidi@jobsoxo.com";
const EFFECTIVE_DATE = "8 November 2026";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to JobsOxo
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Shield className="h-7 w-7 text-blue-600" />
          <h1 className="text-3xl font-bold">{COMPANY} Privacy Policy</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-10">Effective date: {EFFECTIVE_DATE}</p>

        <div className="prose prose-sm max-w-none space-y-8 text-foreground">

          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Who We Are</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY} (<a href={APP_URL} className="text-blue-600 hover:underline">{APP_URL}</a>) is a business management and invoicing application designed for construction painting and decorating businesses. This Privacy Policy explains what information we collect, how we use it, and the choices available to you.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <div>
                <h3 className="font-medium text-foreground mb-1">Account information</h3>
                <p>When you register, we collect your name, email address, and a hashed password. If you sign in via Google or Yahoo OAuth, we receive your name and email address from that provider — we do not receive or store your social login password.</p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Business data you enter</h3>
                <p>Clients, jobs, invoices, line items, change orders, employee records, and payroll information that you create within the app are stored in our database and used solely to provide the service to you.</p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Gmail data (optional, per-user)</h3>
                <p>If you choose to connect your Gmail account, we request read-only access (<code className="bg-muted px-1 py-0.5 rounded text-xs">gmail.readonly</code> scope) to fetch your inbox messages and surface them as an action list inside the app. We also store OAuth tokens (access token and refresh token) in our database to maintain the connection across sessions. We do <strong>not</strong> read, store, or transmit the body content of your emails beyond displaying the subject line, sender, and snippet inside the app. You can disconnect Gmail at any time from the Inbox Tasks page.</p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Usage data</h3>
                <p>We collect standard server logs including IP addresses, request timestamps, and HTTP response codes for security monitoring and error diagnosis. These are not sold or shared with third parties.</p>
              </div>
            </div>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-relaxed">
              <li>To provide, operate, and maintain the {COMPANY} service</li>
              <li>To send invoices and payment reminder emails to your clients on your behalf (via the Resend email service)</li>
              <li>To display your Gmail inbox as an action list within the app (only if you connect Gmail)</li>
              <li>To send you password reset emails when requested</li>
              <li>To respond to support enquiries</li>
              <li>To detect and prevent fraud or abuse</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We do <strong>not</strong> sell your personal data or business data to any third party. We do not use your data for advertising purposes.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">4. Third-Party Services</h2>
            <div className="space-y-3 text-muted-foreground leading-relaxed">
              <div className="border rounded-lg p-4 space-y-1">
                <p className="font-medium text-foreground">Resend (resend.com)</p>
                <p>Used to deliver transactional emails (invoice emails, payment reminders, password resets). Your clients' email addresses are transmitted to Resend solely for delivery purposes.</p>
              </div>
              <div className="border rounded-lg p-4 space-y-1">
                <p className="font-medium text-foreground">Google (OAuth &amp; Gmail API)</p>
                <p>Used for Google sign-in and optional Gmail inbox access. Governed by <a href="https://policies.google.com/privacy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a>. Our use of Gmail data complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
              </div>
              <div className="border rounded-lg p-4 space-y-1">
                <p className="font-medium text-foreground">Render (render.com)</p>
                <p>The application and its database are hosted on Render's infrastructure in the United States. Your data is stored on Render-managed servers. See <a href="https://render.com/privacy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Render's Privacy Policy</a>.</p>
              </div>
            </div>
          </section>

          {/* 5 — Gmail Limited Use */}
          <section>
            <h2 className="text-xl font-semibold mb-3">5. Google API Limited Use Disclosure</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY}'s use of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Specifically:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-relaxed mt-3">
              <li>We only access Gmail data with your explicit authorisation.</li>
              <li>We use Gmail data solely to show your inbox as an action list within {COMPANY} — no other purpose.</li>
              <li>We do not transfer Gmail data to third parties except as necessary to provide the service, and never for advertising.</li>
              <li>We do not use Gmail data for serving advertisements.</li>
              <li>We do not allow humans to read your Gmail data unless you have given explicit permission or it is required for security purposes.</li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your account data and business data for as long as your account is active. If you delete your account or disconnect Gmail, the associated data (including Gmail OAuth tokens and cached inbox tasks) is deleted from our database. Server logs are retained for up to 90 days.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">7. Your Rights</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-relaxed">
              <li><strong>Access:</strong> You can view all your data within the app at any time.</li>
              <li><strong>Correction:</strong> You can edit your data within the app.</li>
              <li><strong>Deletion:</strong> You can request deletion of your account and all associated data by emailing us at <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a>.</li>
              <li><strong>Gmail disconnect:</strong> You can revoke Gmail access at any time from the Inbox Tasks page. This immediately deletes your stored Gmail tokens and cached inbox data.</li>
            </ul>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">8. Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              Passwords are stored as bcrypt hashes — we never store plaintext passwords. Gmail OAuth tokens are encrypted in transit (HTTPS) and stored in a secured PostgreSQL database. Sessions use signed, HTTP-only cookies. We follow industry-standard practices but cannot guarantee absolute security.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">9. Children's Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY} is not directed at children under 13. We do not knowingly collect personal information from children.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">10. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. If we make material changes we will update the effective date at the top of this page. Continued use of the service after any changes constitutes your acceptance of the updated policy.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">11. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              Questions about this policy? Email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-12 pt-6 border-t text-sm text-muted-foreground flex flex-wrap gap-4">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/" className="hover:text-foreground transition-colors">Back to {COMPANY}</Link>
        </div>
      </div>
    </div>
  );
}
