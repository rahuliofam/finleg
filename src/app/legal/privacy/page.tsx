export const metadata = {
  title: "Privacy Policy | Finleg",
};

export default function PrivacyPage() {
  return (
    <section className="py-16 sm:py-24 px-6">
      <div className="max-w-3xl mx-auto prose prose-slate prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl prose-h3:text-lg">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: March 15, 2026</p>

        <h2>1. Introduction</h2>
        <p>
          Finleg (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) describes how it collects, uses,
          discloses, and protects personal information when you use finleg.net and related services.
        </p>
        <p>
          Finleg implements a privacy-first architecture. We minimize what we keep, encrypt sensitive
          data at rest and in transit, and only decrypt when needed in authorized server paths.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Finleg is a financial and legal document management platform enabling users to organize,
          track, and analyze financial statements, legal documents, and bookkeeping data using
          artificial intelligence for document processing and extraction.
        </p>

        <h2>3. Information We Collect</h2>
        <h3>Collected</h3>
        <ul>
          <li>Account information (email address for login and recovery)</li>
          <li>Financial data (statements, balances, transactions)</li>
          <li>Uploaded documents (financial statements, legal documents, stored in isolated per-user storage)</li>
          <li>Brokerage connections (encrypted OAuth tokens, where applicable)</li>
          <li>Essential cookies for session and preference maintenance</li>
        </ul>
        <h3>Not Collected</h3>
        <ul>
          <li>Social Security numbers, dates of birth, or government IDs</li>
          <li>Brokerage passwords (industry-standard OAuth used instead)</li>
          <li>Browsing history, device fingerprints, or analytics cookies</li>
          <li>Data is never sold or shared with advertisers</li>
        </ul>

        <h2>4. How We Use Your Information</h2>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Process and display financial and legal document data</li>
          <li>Extract financial data from uploaded documents using AI/LLM services</li>
          <li>Authenticate identity and secure accounts</li>
          <li>Communicate about the Service</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>5. How We Process Your Documents</h2>
        <p>When you upload documents:</p>
        <ol>
          <li><strong>Upload</strong> &mdash; Files stored in encrypted, per-user cloud storage</li>
          <li><strong>AI Extraction</strong> &mdash; Files sent to AI model to extract structured data</li>
          <li><strong>Data Storage</strong> &mdash; Only structured output saved; raw AI responses discarded immediately</li>
          <li><strong>Confirmation</strong> &mdash; Data written to your account after extraction</li>
        </ol>
        <p>
          AI providers (Anthropic Claude, Google Gemini) see uploaded document content during
          processing. Per their API terms, data is not used for model training.
        </p>

        <h2>6. How We Protect Your Data</h2>
        <ul>
          <li><strong>Encryption</strong> &mdash; Sensitive fields use AES-256-GCM encryption (same standard as banks and governments)</li>
          <li><strong>Row-Level Security</strong> &mdash; Every database table enforces user-only data access</li>
          <li><strong>Data Isolation</strong> &mdash; Uploaded files stored in per-user folders with access policies</li>
          <li><strong>Log Redaction</strong> &mdash; Sensitive fields automatically redacted from all server-side logging</li>
          <li><strong>Transit Security</strong> &mdash; All data transmitted over HTTPS</li>
        </ul>

        <h2>7. Data Retention</h2>
        <table>
          <thead>
            <tr><th>Data</th><th>Retention</th></tr>
          </thead>
          <tbody>
            <tr><td>Account and financial data</td><td>Kept until account deletion</td></tr>
            <tr><td>Uploaded source files</td><td>Kept until user deletes them</td></tr>
            <tr><td>Raw AI responses</td><td>Never stored</td></tr>
            <tr><td>Brokerage tokens</td><td>Kept until disconnection; auto-expire</td></tr>
          </tbody>
        </table>
        <p>
          Users can delete any upload and associated data anytime. Account deletion permanently
          removes all associated data.
        </p>

        <h2>8. Third-Party Services</h2>
        <ul>
          <li><strong>Supabase</strong> &mdash; Database, authentication, file storage (hosted on AWS)</li>
          <li><strong>Anthropic (Claude)</strong> &mdash; AI document extraction; data not used for training</li>
          <li><strong>Google (Gemini)</strong> &mdash; AI document extraction; data not used for training</li>
          <li><strong>Intuit (QuickBooks)</strong> &mdash; Bookkeeping data sync via OAuth</li>
          <li><strong>Cloudflare (R2)</strong> &mdash; Document storage</li>
        </ul>
        <p>No other third parties receive your data.</p>

        <h2>9. Your Rights</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li><strong>Access</strong> &mdash; View all your data in the dashboard anytime</li>
          <li><strong>Delete</strong> &mdash; Delete individual uploads, accounts, or your entire account</li>
          <li><strong>Export</strong> &mdash; Your financial data belongs to you; data export is supported</li>
          <li>Request correction of inaccurate data</li>
          <li>Object to or restrict certain processing</li>
        </ul>
        <p>
          Texas residents have additional rights under the Texas Data Privacy and Security Act (TDPSA).
          Contact <a href="mailto:privacy@finleg.net">privacy@finleg.net</a> to exercise any rights.
        </p>

        <h2>10. Children&apos;s Privacy</h2>
        <p>
          The Service is not intended for individuals under 18. We do not knowingly collect personal
          information from children.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy periodically, notifying users of material changes by
          posting the updated policy on this page with a revised &quot;Last updated&quot; date.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          For questions about this Privacy Policy or data handling,
          contact: <a href="mailto:privacy@finleg.net">privacy@finleg.net</a>
        </p>

        <hr />
        <p className="text-sm text-slate-500">&copy; 2026 Finleg. All rights reserved.</p>
      </div>
    </section>
  );
}
