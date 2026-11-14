'use client';

import { FC, useCallback, useState } from 'react';

export const DeletionRequestForm: FC = () => {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle'
  );

  const submit = useCallback(async () => {
    setState('sending');
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/legal/data-deletion-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, note }),
        }
      );
      setState(response.ok ? 'done' : 'error');
    } catch (err) {
      setState('error');
    }
  }, [email, note]);

  if (state === 'done') {
    return (
      <p>
        Request received. If an account exists for that email we will verify
        and process the deletion; watch your inbox for a confirmation.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[12px] max-w-[440px]">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Account email"
        className="rounded-[8px] bg-[#0E0E0E] border border-white/20 px-[14px] py-[10px] text-white"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything we should know (optional)"
        rows={3}
        className="rounded-[8px] bg-[#0E0E0E] border border-white/20 px-[14px] py-[10px] text-white"
      />
      <button
        onClick={submit}
        disabled={state === 'sending' || !email}
        className="rounded-[8px] bg-[#FC69FF] text-black font-semibold px-[14px] py-[10px] disabled:opacity-50"
      >
        {state === 'sending' ? 'Sending...' : 'Request deletion'}
      </button>
      {state === 'error' ? (
        <p className="text-[#FC69FF]">
          Something went wrong, please try again or use the email option
          below.
        </p>
      ) : null}
    </div>
  );
};
