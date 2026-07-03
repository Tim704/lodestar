// Weekly review — the Sunday telegram (integration #6).

import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { AssistantDoc } from '@lodestar/shared';
import { api } from '../api';
import { EmptyState, Spinner, Telegram } from '../components/ui';

export default function ReviewPage() {
  const [review, setReview] = useState<AssistantDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ review: AssistantDoc }>('/api/assistant/review')
      .then((d) => setReview(d.review))
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <EmptyState icon="✉" title="Review failed to load" hint={error} />;
  if (!review) return <Spinner label="Compiling the week…" />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="h-display mb-1 text-3xl">✉ Weekly review</h1>
      <p className="mb-4 text-sm text-muted">
        Week of {DateTime.fromISO(review.for_date).toFormat('d LLLL yyyy')} — it also files itself
        Sunday evenings.
      </p>
      <div className="card p-4">
        <Telegram md={review.content} />
      </div>
    </div>
  );
}
