export const dynamic = 'force-dynamic';
import Link from 'next/link';

export default function TermsPage() {
  const operator = process.env.NEXT_PUBLIC_LEGAL_OPERATOR;
  const contact = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;

  return (
    <>
      <h1 className="text-[28px] font-semibold">Terms of Service</h1>
      <p className="text-white/60 text-[13px]">Last updated: 2026-11-13</p>

      {!operator || !contact ? (
        <p className="text-[#FC69FF]">
          Legal operator details are not configured for this deployment. Set
          NEXT_PUBLIC_LEGAL_OPERATOR and NEXT_PUBLIC_LEGAL_CONTACT_EMAIL
          before opening this deployment to users.
        </p>
      ) : null}

      <h2 className="text-[18px] font-semibold pt-[8px]">The Service</h2>
      <p>
        {operator || '[operator name not configured]'} provides Latte Social,
        a tool for scheduling, publishing and analysing content on social
        media channels that you connect and authorise.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Your account</h2>
      <ul className="list-disc pl-[20px] flex flex-col gap-[6px]">
        <li>You must be authorised to manage every channel you connect.</li>
        <li>
          You are responsible for the content you schedule or publish through
          the Service, and for complying with each platform&apos;s terms
          (Meta Platform Terms, Zalo OA terms, and so on).
        </li>
        <li>
          We may suspend accounts that abuse the Service or violate platform
          policies.
        </li>
      </ul>

      <h2 className="text-[18px] font-semibold pt-[8px]">
        Platform API usage
      </h2>
      <p>
        The Service accesses connected platforms only with tokens you grant
        and only for the features you use: publishing, scheduling and
        analytics. Disconnecting a channel revokes future access; deleting
        your account removes stored tokens.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Availability</h2>
      <p>
        The Service is provided &quot;as is&quot;. Publishing depends on
        third-party platform APIs; a platform outage or permission change can
        delay or fail a scheduled post.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Contact</h2>
      <p>
        Questions: {contact || '[contact email not configured]'}. See also our{' '}
        <Link href="/legal/privacy" className="text-[#FC69FF]">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  );
}
