import { websiteConfig } from '../../config/website';
import { m } from '../../locale/paraglide/messages';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { BlogPost } from '../../lib/blog';
import { localePath } from '../../locale';
import { Markdown } from './markdown';
import { safeImageSource, coverImageProps } from './image';
export function BlogArticle({ post }: { post: BlogPost }) {
  const cover = safeImageSource(post.image);
  return (
    <article className="article-page">
      <a className="back-link" href={localePath('/blog')}>
        <ArrowLeft size={15} />
        {m.blog_blog_back_to_journal()}
      </a>
      <header>
        <div className="blog-meta">
          <span>{post.category}</span>
          <time dateTime={post.date}>{post.date}</time>
        </div>
        <h1>{post.title}</h1>
        <p>{post.description}</p>
        <div className="article-author">
          <span className="avatar">E</span>
          <div>
            <strong>{websiteConfig.name}</strong>
            <small>{m.blog_blog_product_engineering()}</small>
          </div>
        </div>
      </header>
      <div className="article-cover">
        {cover ? (
          <img
            src={cover}
            {...coverImageProps(post, "(max-width: 800px) 100vw, 800px")}
            alt={post.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <>
            <span>✳</span>
            <small>{m.blog_notes_from_making()}</small>
          </>
        )}
      </div>
      <Markdown content={post.content} />
      <footer className="article-footer">
        <p>{m.blog_blog_thanks_for_reading_now_make_something_good()}</p>
        <a className="button secondary" href={localePath('/blog')}>
          {m.blog_blog_more_stories()}
          <ArrowUpRight size={16} />
        </a>
      </footer>
    </article>
  );
}
