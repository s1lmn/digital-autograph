'use client';
import { useLocale } from './locale-provider';

export function needsFirstUseConfirmation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    [
      'FIRST_USE_REQUIRED',
      'LEGAL_DOCUMENT_CHANGED',
      'LEGAL_DOCUMENT_UNAVAILABLE',
    ].includes(String(error.code))
  );
}
export function FirstUseActionNotice({ returnTo }: { returnTo: string }) {
  const { t } = useLocale();

  return (
    <p>
      {t('Перед новым действием проверьте актуальные условия.')}{' '}
      <a
        href={`/legal/first-use?returnTo=${encodeURIComponent(returnTo)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('Открыть подтверждения в новой вкладке')}
      </a>
      {t(
        '. Затем вернитесь сюда и повторите действие. Текущая вкладка остаётся открытой.',
      )}
    </p>
  );
}
