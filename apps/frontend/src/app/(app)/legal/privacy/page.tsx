export const dynamic = 'force-dynamic';
import Link from 'next/link';

export default function PrivacyPage() {
  const operator = process.env.NEXT_PUBLIC_LEGAL_OPERATOR;
  const contact = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;

  return (
    <>
      <h1 className="text-[28px] font-semibold">Privacy Policy</h1>
      <p className="text-white/60 text-[13px]">Last updated: 2026-11-13</p>

      {!operator || !contact ? (
        <p className="text-[#FC69FF]">
          Legal operator details are not configured for this deployment. Set
          NEXT_PUBLIC_LEGAL_OPERATOR and NEXT_PUBLIC_LEGAL_CONTACT_EMAIL
          before opening this deployment to users.
        </p>
      ) : null}

      <h2 className="text-[18px] font-semibold pt-[8px]">Who we are</h2>
      <p>
        {operator ||
          '[operator name not configured]'}{' '}
        operates Latte Social (&quot;the Service&quot;), a tool that schedules
        and publishes content to social media channels you connect, and
        reports analytics back from those channels. You can reach us at{' '}
        {contact || '[contact email not configured]'}.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Data we collect</h2>
      <ul className="list-disc pl-[20px] flex flex-col gap-[6px]">
        <li>
          Account data: name, email address, password hash or OAuth identity
          used to sign in.
        </li>
        <li>
          Connected channel data: OAuth tokens, channel names, profile
          pictures and public identifiers for the social accounts you
          explicitly connect (Facebook Pages, Instagram accounts, Zalo OAs
          and others you choose). Tokens are stored in the Service&apos;s
          database and used only to publish and read analytics on your
          behalf.
        </li>
        <li>
          Content you create: post text, media uploads, schedules, and
          related metadata.
        </li>
        <li>
          Usage and diagnostic data: error reports and aggregate usage
          metrics used to operate the Service.
        </li>
      </ul>

      <h2 className="text-[18px] font-semibold pt-[8px]">
        How we use social platform data
      </h2>
      <p>
        We use data returned by platform APIs (including Meta platforms)
        only to provide the features you see: publishing scheduled posts,
        listing your channels, and displaying post performance such as
        views, likes, comments and shares. We do not sell platform data, use
        it for advertising, or build profiles of your audience.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Sharing</h2>
      <p>
        We share data only with the platforms you connect (to publish and
        fetch analytics as you instruct) and with infrastructure providers
        that run the Service (hosting, database, email). We do not share
        your data with data brokers.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">Your choices</h2>
      <p>
        You can disconnect a channel at any time from Settings, which stops
        future API access. To request deletion of your account and
        associated data, use the{' '}
        <Link href="/legal/data-deletion" className="text-[#FC69FF]">
          data deletion page
        </Link>{' '}
        or email us at {contact || '[contact email not configured]'}.
      </p>
    </>
  );
}
