export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import Link from 'next/link';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <MantineWrapper>
      <Toaster />
      <div className="bg-[#0E0E0E] min-h-screen w-screen text-white flex flex-col items-center p-[24px]">
        <div className="w-full max-w-[760px] flex flex-col gap-[32px]">
          <div className="flex items-center justify-between">
            <LogoTextComponent />
            <div className="flex gap-[16px] text-[14px]">
              <Link href="/legal/privacy" className="hover:text-[#FC69FF]">
                Privacy
              </Link>
              <Link href="/legal/terms" className="hover:text-[#FC69FF]">
                Terms
              </Link>
              <Link
                href="/legal/data-deletion"
                className="hover:text-[#FC69FF]"
              >
                Data deletion
              </Link>
            </div>
          </div>
          <div className="rounded-[12px] bg-[#1A1919] p-[32px] flex flex-col gap-[16px] leading-relaxed text-[15px]">
            {children}
          </div>
        </div>
      </div>
    </MantineWrapper>
  );
}
