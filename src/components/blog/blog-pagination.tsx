import { m } from '../../locale/paraglide/messages';
import { localePath } from '../../locale';
import { blogListingPath } from '../../lib/blog-listing';

export function BlogPagination({ currentPage, totalPages, category = '' }: { currentPage: number; totalPages: number; category?: string }) {
  return (
<nav className="pagination" aria-label={m.blog_blog_blog_pagination()}>
        <span>
          {m.blog_blog_page_of({ value1: currentPage, value2: totalPages })}
        </span>
        <div className="row">
          {currentPage > 1 && (
            <a
              className="button secondary"
              href={localePath(blogListingPath(currentPage - 1, category))}
            >
              {m.blog_blog_previous()}
            </a>
          )}
          {currentPage < totalPages && (
            <a
              className="button secondary"
              href={localePath(blogListingPath(currentPage + 1, category))}
            >
              {m.blog_blog_next()}
            </a>
          )}
        </div>
      </nav>
  );
}
