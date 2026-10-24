import { m } from '../../locale/paraglide/messages';
import { Markdown } from '../blog/markdown';
import type { LegalPageData, ChangelogData } from '../../lib/content-types';
import { Notice, SectionTitle } from '../ui/core';
export function LegalPage({ page }: LegalPageData) {
  return (
    <div className="container info-page">
      <SectionTitle
        eyebrow={m.pages_information_the_details()}
        title={page.title}
        description={page.description}
      />
      <p className="fine-print">
        {m.pages_information_updated()} {page.date}
      </p>
      <Notice>{m.pages_information_sample_policy_content_the_site_operator_must()}</Notice>
      <Markdown content={page.content} />
    </div>
  );
}
export function ChangelogPage({ releases }: { releases: ChangelogData }) {
  return (
    <div className="container info-page">
      <SectionTitle
        eyebrow={m.pages_information_small_steps_forward()}
        title={m.pages_information_changelog()}
        description={m.pages_information_what_s_new_what_s_better_and()}
      />
      {releases.map((item) => (
        <section key={item.slug} className="release">
          <div className="row">
            <span className="badge">{item.version}</span>
            <time className="fine-print">{item.date}</time>
          </div>
          <h2>{item.title}</h2>
          <p className="muted">{item.description}</p>
          <Markdown content={item.content} />
        </section>
      ))}
    </div>
  );
}
