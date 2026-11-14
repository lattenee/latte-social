export const dynamic = 'force-dynamic';
import { DeletionRequestForm } from './deletion.request.form';

export default function DataDeletionPage() {
  const contact = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;

  return (
    <>
      <h1 className="text-[28px] font-semibold">Data Deletion</h1>

      <p>
        You can request deletion of your Latte Social account and the data
        associated with it: your profile, connected channel tokens, posts,
        media and analytics history. Deleting is permanent.
      </p>

      <h2 className="text-[18px] font-semibold pt-[8px]">
        What happens when you request deletion
      </h2>
      <ol className="list-decimal pl-[20px] flex flex-col gap-[6px]">
        <li>Submit your account email below. We record the request.</li>
        <li>
          A human operator verifies the request belongs to your account. We
          may email you for confirmation first.
        </li>
        <li>
          An operator deletes the account record and removes connected
          channel tokens, posts and analytics records from the Service&apos;s
          database. Uploaded media files held in object storage are purged
          separately by the operator and may take additional time. Copies on
          the platforms themselves (posts already published to Facebook,
          Instagram, Zalo, etc.) are not removed - delete them on the
          platform if needed.
        </li>
        <li>We aim to complete requests within 30 days.</li>
      </ol>

      <h2 className="text-[18px] font-semibold pt-[8px]">
        Request deletion
      </h2>
      <DeletionRequestForm />

      <p className="text-white/60 text-[13px]">
        Prefer email? Write to {contact || '[contact email not configured]'}{' '}
        with the subject &quot;Data deletion&quot;.
      </p>
    </>
  );
}
