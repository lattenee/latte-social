'use client';

import { FC, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { OnboardingModal } from '@gitroom/frontend/components/onboarding/onboarding.modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const Onboarding: FC = () => {
  const query = useSearchParams();
  const modal = useModals();
  const router = useRouter();
  const user = useUser();
  const modalOpen = useRef(false);
  const t = useT();

  const handleClose = useCallback(() => {
    modal.closeAll();
    router.push('/launches');
  }, [modal, router]);

  useEffect(() => {
    const onboarding = query.get('onboarding');
    if (!onboarding) {
      if (modalOpen.current) {
        modalOpen.current = false;
        modal.closeAll();
      }
      return;
    }
    if (modalOpen.current) {
      return;
    }
    // Wait until /user/self resolves so a persisted onboardedAt can be seen;
    // a completed workspace must not re-enter onboarding from a stale
    // ?onboarding=true link or a re-triggered onboarding header.
    if (!user) {
      return;
    }
    if (user.onboardedAt) {
      router.replace('/launches');
      return;
    }
    modalOpen.current = true;
    modal.openModal({
      // title: t('onboarding', 'Welcome to Latte'),
      withCloseButton: true,
      closeOnEscape: false,
      removeLayout: true,
      askClose: true,
      fullScreen: true,
      onClose: handleClose,
      children: <OnboardingModal onClose={handleClose} />,
    });
  }, [query, user, handleClose, router, modal, t]);

  return null;
};
