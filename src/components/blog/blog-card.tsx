import { websiteConfig } from '../../config/website';
import { m } from '../../locale/paraglide/messages';
import { ArrowUpRight } from 'lucide-react';
import type { BlogSummary } from '../../lib/content-types';
import { localePath } from '../../locale';
import { safeImageSource, coverImageProps } from './image';

/** Customize the card here; BlogGrid and the actual listing use this component. */
export function BlogCard({ post, index = 0 }: { post: BlogSummary; index?: number }) {
  const cover = safeImageSource(post.image);
  return (
    <a className="blog-card" href={localePath(`/blog/${post.slug}`)}>
      <div className={`blog-cover cover-${index % 4}`}>
        {cover ? (
          <img
            src={cover}
            {...coverImageProps(post, "(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 360px")}
            alt={post.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <>
            <span>{index % 2 ? '✧' : '✳'}</span>
            <small>{websiteConfig.name} / JOURNAL</small>
          </>
        )}
        <ArrowUpRight size={20} />
      </div>
      <div className="blog-card-body">
        <div className="blog-meta">
          <span>{post.category}</span>
          <time dateTime={post.date}>{post.date}</time>
        </div>
        <h2>{post.title}</h2>
        <p>{post.description}</p>
        <span className="text-link">
          {m.blog_blog_read_the_story()}
          <ArrowUpRight size={16} />
        </span>
      </div>
    </a>
  );
}
