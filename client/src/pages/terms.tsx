import { Link } from "wouter";
import { ArrowLeft, ScrollText } from "lucide-react";

const COMPANY = "JobsOxo";
const APP_URL = "https://jobsoxo.replit.app";
const CONTACT_EMAIL = "support@jobsoxo.replit.app";
const EFFECTIVE_DATE = "20 June 2025";

export default function Terms() {
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
          <ScrollText className="h-7 w-7 text-blue-600" />
          <h1 className="text-3xl font-bold">{COMPANY} Terms of Service</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-10">Effective date: {EFFECTIVE_DATE}</p>

        <div className="space-y-8 text-foreground">

          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By creating an account or using {COMPANY} (<a href={APP_URL} className="text-blue-600 hover:underline">{APP_URL}</a>), you agree to be bound by these Terms of Service. If you do not agree, please do not use the service. These terms apply to all users of the application.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY} is a business management platform for construction painting and decorating businesses. It provides tools for managing clients, jobs, invoices, line items, change orders, payroll, scheduling, and email communication with clients. An optional Gmail integration allows users to view their inbox as an action list within the app.
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">3. Account Registration</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-relaxed">
              <li>You must provide accurate information when creating an account.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You must notify us immediately if you suspect unauthorised access to your account.</li>
              <li>You may not share your account with other individuals. Each user should have their own account.</li>
              <li>You must be at least 18 years old to create an account.</li>
            </ul>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">4. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-relaxed">
              <li>Use the service for any unlawful purpose or in violation of any applicable laws or regulations</li>
              <li>Upload or transmit malicious code, viruses, or harmful data</li>
              <li>Attempt to gain unauthorised access to other users' accounts or data</li>
              <li>Use the service to send unsolicited bulk email (spam)</li>
              <li>Reverse engineer, decompile, or attempt to extract source code from the application</li>
              <li>Resell, sublicense, or make the service available to third parties without our written consent</li>
              <li>Impersonate any person or entity or misrepresent your affiliation with any person or entity</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">5. Gmail Integration</h2>
            <p className="text-muted-foreground leading-relaxed">
              The optional Gmail connection requests read-only access to your Gmail inbox. By connecting Gmail you authorise {COMPANY} to read your inbox metadata (subject lines, sender names, and message snippets) to display an action list inside the app. You can disconnect Gmail at any time from the Inbox Tasks page. Disconnecting immediately removes all stored Gmail credentials and cached inbox data from our systems. Our access to your Gmail data is governed by <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Google's API Services User Data Policy</a>.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">6. Your Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain full ownership of all business data you enter into {COMPANY} (clients, jobs, invoices, payroll records, etc.). We do not claim any intellectual property rights over your data. By using the service you grant us a limited licence to store and process your data solely to provide the service to you. We will not access, use, or share your data for any purpose beyond operating the service. See our <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link> for full details.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">7. Email Sending</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY} can send emails to your clients on your behalf (invoices, payment reminders). You are solely responsible for ensuring you have the appropriate consent from your clients to contact them by email, and for the accuracy and legality of the content you send. We are not liable for any disputes arising from emails sent through the service.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">8. Service Availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              We aim to keep {COMPANY} available at all times but do not guarantee uninterrupted access. The service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We are not liable for any loss or inconvenience caused by downtime.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">9. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">
              The {COMPANY} application, including its design, code, and content (excluding your data), is our intellectual property. You may not copy, modify, distribute, or create derivative works from the application without our express written permission.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">10. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed">
              The service is provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the service will be error-free, secure, or continuously available.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">11. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              To the maximum extent permitted by law, {COMPANY} and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, goodwill, or business interruption, arising out of or in connection with your use of or inability to use the service, even if we have been advised of the possibility of such damages. Our total liability to you for any claim arising out of these terms or the service shall not exceed the amount you paid us in the twelve months preceding the claim.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">12. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to suspend or terminate your account at any time if you violate these Terms of Service, with or without notice. You may stop using the service at any time. Upon termination, your right to access the service ceases immediately. You may request deletion of your data by contacting us at <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">13. Changes to These Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update these Terms of Service from time to time. We will notify users of material changes by updating the effective date at the top of this page. Continued use of the service after any changes constitutes your acceptance of the updated terms.
            </p>
          </section>

          {/* 14 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">14. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms of Service are governed by and construed in accordance with the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.
            </p>
          </section>

          {/* 15 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">15. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              Questions about these terms? Email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-12 pt-6 border-t text-sm text-muted-foreground flex flex-wrap gap-4">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/" className="hover:text-foreground transition-colors">Back to {COMPANY}</Link>
        </div>
      </div>
    </div>
  );
}
