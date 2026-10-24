import { useState } from 'react';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { m } from '../../locale/paraglide/messages';
import { Button, Notice } from '../ui/core';

/** A boundary reset alone preserves a failed route match. Retry its loader first. */
export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="container error-page">
      <h1>{m.routes_root_something_interrupted_this_page()}</h1>
      <Notice kind="error">{m.routes_root_please_try_again_if_the_problem_continues()}</Notice>
      <Button
        busy={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await router.invalidate({ sync: true });
            reset();
          } finally {
            setRetrying(false);
          }
        }}
      >
        {m.routes_root_try_again()}
      </Button>
    </div>
  );
}
