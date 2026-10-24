import { m } from '../../locale/paraglide/messages';
import type { BlogListingData } from '../../lib/content-types';
import { localePath } from '../../locale';
import { blogListingPath } from '../../lib/blog-listing';
import { SectionTitle } from '../ui/core';
import { BlogGrid } from './blog-grid';
import { BlogPagination } from './blog-pagination';

export function BlogListing(result: BlogListingData) {
  const { category, categories } = result;
  return (
    <div className="container journal-page">
      <SectionTitle
        eyebrow={m.blog_blog_the_journal()}
        title={m.blog_blog_notes_from_the_making()}
        description={m.blog_blog_ideas_decisions_and_small_details_behind_a()}
      />
      <nav className="category-nav" aria-label={m.blog_blog_blog_categories()}>
        <a className={!category ? 'active' : ''} href={localePath('/blog')}>
          {m.blog_blog_all_stories()}
        </a>
        {categories.map((value) => (
          <a
            key={value}
            className={category === value ? 'active' : ''}
            href={localePath(blogListingPath(1, value))}
          >
            {value}
          </a>
        ))}
      </nav>
      <BlogGrid posts={result.posts} />
      {!result.posts.length && <p>{m.blog_blog_no_stories_in_this_category_yet()}</p>}
      <BlogPagination currentPage={result.currentPage} totalPages={result.totalPages} category={category} />
    </div>
  );
}
