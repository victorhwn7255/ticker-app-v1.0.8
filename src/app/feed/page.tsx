import { redirect } from 'next/navigation';

/** The feed is the landing page now; keep old /feed links working. */
export default function FeedRedirect() {
  redirect('/');
}
