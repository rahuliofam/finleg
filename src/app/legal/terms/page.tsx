export const metadata = {
  title: "Terms of Service | Finleg",
};

export default function TermsPage() {
  return (
    <section className="py-16 sm:py-24 px-6">
      <div className="max-w-3xl mx-auto prose prose-slate prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl">
        <h1>Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: March 15, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing Finleg&apos;s services through finleg.net, you agree to be bound by these Terms.
          If you do not agree, you should not use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Finleg operates as a financial and legal document management platform enabling users to
          organize financial statements, legal documents, and bookkeeping data, and to connect
          brokerage and accounting accounts for aggregated viewing using artificial intelligence
          for document data extraction.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          Users must be at least 18 years old. By using the Service, you represent that you meet
          this requirement and have the legal capacity to enter into these Terms.
        </p>

        <h2>4. Account Responsibilities</h2>
        <ul>
          <li>Users must maintain credential confidentiality</li>
          <li>Users are responsible for all account activities</li>
          <li>Users must provide accurate, complete account information</li>
          <li>Users must immediately notify Finleg of unauthorized access</li>
        </ul>

        <h2>5. Acceptable Use</h2>
        <p>Users agree not to:</p>
        <ul>
          <li>Use the Service unlawfully</li>
          <li>Attempt unauthorized access to any Service component</li>
          <li>Interfere with Service integrity or performance</li>
          <li>Upload malicious files or exploitative content</li>
          <li>Store or transmit content infringing third-party rights</li>
          <li>Resell, redistribute, or sublicense Service access</li>
        </ul>

        <h2>6. Financial Data Disclaimer</h2>
        <p>
          Finleg is not a financial advisor, broker-dealer, or investment adviser. The Service
          functions as a data aggregation and document management tool only. Nothing on this
          platform constitutes financial, investment, legal, or tax advice. Users should not make
          financial decisions based solely on Service information. Data may contain errors requiring
          verification with financial institutions or legal counsel.
        </p>

        <h2>7. AI-Processed Data</h2>
        <p>
          The Service uses artificial intelligence and large language models for data extraction.
          While accuracy is pursued, AI-extracted data may contain errors, omissions, or
          misinterpretations. Users must review and verify extracted data before relying on it.
        </p>

        <h2>8. Third-Party Integrations</h2>
        <p>
          Service integrations with third-party accounts (brokerage, accounting, storage) are
          subject to respective third-party terms and policies. Finleg is not responsible for
          availability, accuracy, or actions of third-party services.
        </p>

        <h2>9. Intellectual Property</h2>
        <p>
          The Service&apos;s design, code, features, and content belong to Finleg and are protected
          by intellectual property laws. Users retain ownership of their uploaded data and documents.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, Finleg and its officers, directors,
          members, employees, and agents shall not be liable for any indirect, incidental, special,
          consequential, or punitive damages. Total liability shall not exceed amounts paid by the
          user in the preceding 12 months.
        </p>

        <h2>11. Disclaimer of Warranties</h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
          express or implied, including but not limited to merchantability, fitness for a particular
          purpose, and non-infringement. Finleg does not warrant uninterrupted, error-free, or
          secure operation.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          Users agree to indemnify and hold harmless Finleg and its personnel from claims,
          liabilities, damages, losses, and expenses arising from Service use or Terms violations.
        </p>

        <h2>13. Termination</h2>
        <p>
          Finleg may suspend or terminate access at any time, with or without cause or notice.
          Users may terminate by contacting Finleg. Upon termination, Service access ceases
          immediately and data will be deleted.
        </p>

        <h2>14. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Texas. Any legal actions must be
          brought exclusively in the state or federal courts located in Travis County, Texas.
        </p>

        <h2>15. Changes to These Terms</h2>
        <p>
          Finleg reserves the right to modify these Terms. Material changes will be communicated
          by posting updated Terms with a revised date. Continued use of the Service after posting
          constitutes acceptance of the revised Terms.
        </p>

        <h2>16. Contact Us</h2>
        <p>
          Questions about these Terms should be directed
          to <a href="mailto:legal@finleg.net">legal@finleg.net</a>.
        </p>

        <hr />
        <p className="text-sm text-slate-500">&copy; 2026 Finleg. All rights reserved.</p>
      </div>
    </section>
  );
}
