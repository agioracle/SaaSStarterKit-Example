import { m } from '../../locale/paraglide/messages';
import { useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
export function Carousel({
  children,
  label = m.ui_carousel_label(),
}: {
  children: ReactNode;
  label?: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  function move(direction: number) {
    content.current?.scrollBy({
      left: direction * content.current.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
  return (
    <section className="ui-carousel" aria-roledescription="carousel" aria-label={label}>
      <div className="carousel-track" ref={content}>
        {children}
      </div>
      <div className="row">
        <button
          type="button"
          className="icon-button"
          aria-label={m.ui_carousel_previous_slide()}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={m.ui_carousel_next_slide()}
          onClick={() => move(1)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
export function CarouselItem({ children, label }: { children: ReactNode; label: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA carousel slides use a named group, not a form fieldset.
    <div className="carousel-item" role="group" aria-roledescription="slide" aria-label={label}>
      {children}
    </div>
  );
}
