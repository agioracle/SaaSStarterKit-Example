import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	aiTaskFromHash,
	aiTaskHash,
	aiTextConstraints,
	createAiRequestTracker,
	observeAiTaskNavigation,
	validSearchResults,
} from '../src/ai/navigation';
import { AI_CARDS } from '../src/ai/types';
import { websiteConfig } from '../src/config/website';
import { getPostBySlug, getSortedPosts, type BlogPost } from '../src/lib/blog';
import { blogArticleHead, type blogListingHead } from '../src/lib/blog-seo';
import { getLocale, type Locale } from '../src/locale';
import { overwriteGetLocale } from '../src/locale/paraglide/runtime';
import { Route as BlogRoute } from '../src/routes/blog.index';
import { Route as ArticleRoute } from '../src/routes/blog.$slug';
import { Route as NotificationsRoute } from '../src/routes/_app.settings.notifications';
import { NotificationsPage } from '../src/components/settings/account';
import { useQuery } from '@tanstack/react-query';
import { Route as HomeRoute } from '../src/routes/index';
import { getLocalizedMetadata } from '../src/config/metadata';
import { publicPlans, type PlanDefinition } from '../src/config/plans';
import {
	formatPlanAmount,
	PricingSection,
	visiblePricingPlans,
} from '../src/components/blocks/pricing';
import { NewsletterCard } from '../src/components/blocks/homepage';
import {
	newsletterOutcome,
	type NewsletterMutationResult,
} from '../src/newsletter/outcome';
import { BlogArticle, BlogCard, Markdown } from '../src/components/blog/blog';
import { Calendar } from '../src/components/ui/calendar';

const uiState = vi.hoisted(() => ({
	session: null as { user: { email: string } } | null,
}));

vi.mock('../src/routes/_app', () => ({ Route: { useRouteContext: vi.fn() } }));
vi.mock('../src/components/auth/auth-form', () => ({
	VerificationResend: () => null,
}));
vi.mock('../src/auth/client', () => ({
	authClient: { useSession: () => ({ data: uiState.session }) },
}));
vi.mock('@tanstack/react-query', async (original) => ({
	...(await original<typeof import('@tanstack/react-query')>()),
	useQuery: vi.fn(() => ({
		data: { subscribed: false },
		error: null,
		isPending: false,
		refetch: vi.fn(),
	})),
}));

const originalGetLocale = getLocale;
const config = websiteConfig as {
	newsletter: { enabled: boolean };
	blog: { enabled: boolean };
};
const initialNewsletterEnabled = config.newsletter.enabled;
beforeEach(() => {
	overwriteGetLocale(() => 'en');
	vi.clearAllMocks();
	uiState.session = null;
});
afterEach(() => {
	overwriteGetLocale(originalGetLocale);
	config.newsletter.enabled = initialNewsletterEnabled;
});

function routeHead(
	route: { options: { head?: unknown } },
	loaderData?: BlogPost,
) {
	const head = route.options.head as (context: {
		loaderData?: BlogPost;
	}) => ReturnType<typeof blogListingHead>;
	return head({ loaderData: loaderData ? { post: loaderData, alternateLocales: [loaderData.locale] } : undefined } as never);
}
function schemaNodes(head: ReturnType<typeof blogListingHead>) {
	return head.scripts.flatMap((script) => {
		const value = JSON.parse(script.children);
		return value['@graph'] ?? [value];
	});
}

describe('blog route metadata', () => {
	it.each(['en', 'zh'] as Locale[])(
		'preserves site graph and localizes the %s listing',
		(locale) => {
			overwriteGetLocale(() => locale);
			const head = routeHead(BlogRoute);
			const nodes = schemaNodes(head);
			expect(nodes.map((node) => node['@type'])).toEqual([
				'Organization',
				'WebSite',
				'CollectionPage',
				'Blog',
			]);
			const canonical = new URL(
				locale === 'zh' ? '/zh/blog' : '/blog',
				websiteConfig.url,
			).href;
			expect(head.links.find((link) => link.rel === 'canonical')?.href).toBe(
				canonical,
			);
			expect(nodes.find((node) => node['@type'] === 'Blog')).toMatchObject({
				url: canonical,
				'@id': `${canonical}#blog`,
				inLanguage: locale,
				isPartOf: { '@id': `${websiteConfig.url}/#website` },
			});
		},
	);

	it.each(['en', 'zh'] as Locale[])(
		'preserves site graph and article metadata for %s',
		(locale) => {
			overwriteGetLocale(() => locale);
			const post = getPostBySlug(getSortedPosts(locale)[0].slug, locale);
      if (!post) throw new Error('Missing published fixture');
			expect(post).toBeDefined();
			const head = routeHead(ArticleRoute, post);
			const nodes = schemaNodes(head);
			expect(nodes.map((node) => node['@type'])).toEqual([
				'Organization',
				'WebSite',
				'WebPage',
				'BlogPosting',
			]);
			const canonical = head.links.find(
				(link) => link.rel === 'canonical',
			)?.href;
			expect(
				nodes.find((node) => node['@type'] === 'BlogPosting'),
			).toMatchObject({
				headline: post.title,
				url: canonical,
				mainEntityOfPage: canonical,
				inLanguage: locale,
				isPartOf: {
					url: new URL(
						locale === 'zh' ? '/zh/blog' : '/blog',
						websiteConfig.url,
					).href,
				},
			});
			expect(head.meta).toContainEqual({
				property: 'og:type',
				content: 'article',
			});
			const alternate = head.links.filter(
				(link) =>
					link.rel === 'alternate' &&
					'hrefLang' in link &&
					link.hrefLang !== 'x-default',
			);
			for (const link of alternate) {
				expect(
					getPostBySlug(
						post.slug,
						'hrefLang' in link && link.hrefLang === 'zh-CN' ? 'zh' : 'en',
					),
				).toBeDefined();
			}
		},
	);

	it('escapes structured data and emits no article metadata without loader data', () => {
		const post = {
			...getPostBySlug(getSortedPosts('en')[0].slug, 'en') as BlogPost,
			title: '</script><script>alert(1)</script>',
		};
		const head = blogArticleHead(post, ['en']);
		expect(
			head.scripts.every((script) => !script.children.includes('</script>')),
		).toBe(true);
		expect(
			schemaNodes(head).find((node) => node['@type'] === 'BlogPosting')
				.headline,
		).toBe(post.title);
		expect(routeHead(ArticleRoute)).toEqual({});
		expect(
			head.links.some(
				(link) => 'hrefLang' in link && link.hrefLang === 'zh-CN',
			),
		).toBe(false);
	});
});

describe('homepage metadata', () => {
	it.each(['en', 'zh'] as Locale[])(
		'keeps all shared graph nodes and configured %s metadata',
		(locale) => {
			overwriteGetLocale(() => locale);
			const metadata = getLocalizedMetadata(locale);
			const head = routeHead(HomeRoute);
			const nodes = schemaNodes(head);
			expect(nodes.map((node) => node['@type'])).toEqual([
				'Organization',
				'WebSite',
				'WebPage',
			]);
			expect(nodes[0].name).toBe(metadata.name);
			expect(head.meta).toContainEqual({ title: metadata.title });
			expect(head.meta).toContainEqual({
				name: 'description',
				content: metadata.description,
			});
			expect(nodes[2]).toMatchObject({
				inLanguage: locale,
				url: new URL(locale === 'zh' ? '/zh/' : '/', websiteConfig.url).href,
			});
		},
	);
});

describe('AI tool hash navigation', () => {
	it.each(AI_CARDS.map(({ id }) => id))(
		'resolves every valid %s card hash',
		(task) => {
			expect(aiTaskFromHash(`#${task}`)).toBe(task);
			expect(aiTaskFromHash(aiTaskHash(task))).toBe(task);
		},
	);

	it('supports documented aliases, empty history entries, and malformed input safely', () => {
		expect(aiTaskFromHash('#web-search')).toBe('web-search');
		expect(aiTaskFromHash('#decision-model')).toBe('decision');
		expect(aiTaskFromHash('#web%2Dsearch')).toBe('web-search');
		expect(aiTaskFromHash('')).toBe('summarize');
		expect(aiTaskFromHash('#')).toBe('summarize');
		for (const hash of [
			'#unknown',
			'#%E0%A4%A',
			'web-search',
			'#__proto__',
			'#toString',
		]) {
			expect(aiTaskFromHash(hash)).toBeNull();
		}
	});

	it('handles initial load, hash changes, back/forward, deduplication, and cleanup', () => {
		const source = Object.assign(new EventTarget(), {
			location: { hash: '#web-search' },
		});
		const select = vi.fn();
		const stop = observeAiTaskNavigation(source, select);
		expect(select).toHaveBeenLastCalledWith('web-search');
		source.location.hash = '#decision-model';
		source.dispatchEvent(new Event('hashchange'));
		source.dispatchEvent(new Event('popstate'));
		expect(select).toHaveBeenCalledTimes(2);
		source.location.hash = '';
		source.dispatchEvent(new Event('popstate'));
		expect(select).toHaveBeenLastCalledWith('summarize');
		source.location.hash = '#web-search';
		source.dispatchEvent(new Event('popstate'));
		expect(select).toHaveBeenLastCalledWith('web-search');
		source.location.hash = '#invalid';
		source.dispatchEvent(new Event('hashchange'));
		expect(select).toHaveBeenCalledTimes(4);
		stop();
		source.location.hash = '#avatar';
		source.dispatchEvent(new Event('hashchange'));
		source.dispatchEvent(new Event('popstate'));
		expect(select).toHaveBeenCalledTimes(4);
	});

	it('aborts old requests and rejects late results, errors, finally blocks, and image reads', async () => {
		const tracker = createAiRequestTracker();
		const first = tracker.start();
		const fileReadIsCurrent = tracker.snapshot();
		const second = tracker.start();
		expect(first.signal.aborted).toBe(true);
		expect(fileReadIsCurrent()).toBe(false);
		let result = 'new result';
		let error = '';
		let busy = true;
		await Promise.resolve().then(() => {
			if (first.isCurrent()) {
				result = 'stale result';
				error = 'stale error';
				busy = false;
			}
		});
		expect({ result, error, busy }).toEqual({
			result: 'new result',
			error: '',
			busy: true,
		});
		expect(second.isCurrent()).toBe(true);
		tracker.invalidate();
		expect(second.signal.aborted).toBe(true);
		expect(second.isCurrent()).toBe(false);
	});

	it('invalidates an active request when browser history selects another task', () => {
		const tracker = createAiRequestTracker();
		const source = Object.assign(new EventTarget(), {
			location: { hash: '#web-search' },
		});
		const stop = observeAiTaskNavigation(source, () => tracker.invalidate());
		const request = tracker.start();
		source.location.hash = '#decision-model';
		source.dispatchEvent(new Event('popstate'));
		expect(request.signal.aborted).toBe(true);
		expect(request.isCurrent()).toBe(false);
		stop();
	});
});

describe('AI input and result contracts', () => {
	it.each([
		['summarize', 50, 500, true],
		['taglines', 10, 500, true],
		['caption', 1, 1000, false],
		['workers-image', 3, 2000, true],
		['fal-image', 3, 2000, true],
		['avatar', 3, 2000, true],
		['decision', 10, 4000, true],
		['web-search', 1, 1024, true],
		['translate', 1, 5000, true],
		['speech', 1, 2000, true],
	] as const)(
		'aligns %s with the effective API/service limits',
		(task, minLength, maxLength, required) => {
			expect(aiTextConstraints(task)).toEqual({
				minLength,
				maxLength,
				required,
			});
		},
	);

	it('parses safe links once and rejects malformed, unsafe, or non-object search results', () => {
		const item = { title: 'Source', description: 'Summary' };
		const results = validSearchResults([
			{ ...item, url: 'https://example.test/a?q=1' },
			{ ...item, url: 'http://example.test/b' },
			...[
				'https://',
				'javascript:alert(1)',
				'data:text/html,x',
				'/relative',
				'https://user:pass@example.test',
			].map((url) => ({ ...item, url })),
			null,
			{},
			{ ...item, url: 42 },
			{ url: 'https://example.test', title: {} },
		]);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			...item,
			url: 'https://example.test/a?q=1',
			hostname: 'example.test',
		});
		expect(validSearchResults(null)).toEqual([]);
	});
});

describe('disabled newsletter settings', () => {
	it('does not mount a resource hook or render controls when disabled', () => {
		config.newsletter.enabled = false;
		const html = renderToStaticMarkup(createElement(NotificationsPage));
		expect(html).toContain('Newsletter subscriptions are not enabled.');
		expect(useQuery).not.toHaveBeenCalled();
		expect(html).not.toContain('<button');
	});
	it('rejects the settings route when disabled and admits it when enabled', () => {
		const beforeLoad = NotificationsRoute.options.beforeLoad as () => void;
		config.newsletter.enabled = false;
		expect(() => beforeLoad()).toThrow();
		config.newsletter.enabled = true;
		expect(() => beforeLoad()).not.toThrow();
		expect(renderToStaticMarkup(createElement(NotificationsPage))).toContain(
			'Subscription status',
		);
		expect(useQuery).toHaveBeenCalledTimes(1);
	});
});

describe('truthful newsletter outcomes', () => {
	it.each([
		[true, true, true, 'success', true],
		[true, false, true, 'success', true],
		[true, true, false, 'info', false],
		[true, false, false, 'error', false],
		[false, true, false, 'success', true],
		[false, false, false, 'success', true],
		[false, true, true, 'info', false],
		[false, false, true, 'error', false],
	] as const)(
		'subscribe=%s accepted=%s subscribed=%s yields %s',
		(subscribe, accepted, subscribed, kind, confirmed) => {
			const outcome = newsletterOutcome({ accepted, subscribed }, subscribe);
			expect(outcome).toMatchObject({ kind, confirmed });
			expect(outcome.message.toLowerCase()).not.toMatch(
				/check your inbox|email.*sent|confirmation email/,
			);
			if (!subscribe && subscribed)
				expect(outcome.message).not.toContain('You have been unsubscribed.');
		},
	);

	it('does not interpret malformed API output as successful state', () => {
		for (const response of [
			null,
			{},
			{ accepted: true },
			{ accepted: true, subscribed: 'false' },
		]) {
			expect(
				newsletterOutcome(
					response as unknown as NewsletterMutationResult,
					true,
				),
			).toMatchObject({ kind: 'error', confirmed: false });
		}
	});

	it('requires an explicit, initially unchecked resubscribe choice in both UIs', () => {
		config.newsletter.enabled = true;
		uiState.session = { user: { email: 'reader@example.test' } };
		for (const Component of [NewsletterCard, NotificationsPage]) {
			const html = renderToStaticMarkup(createElement(Component));
			expect(html).toContain(
				'If I previously unsubscribed, subscribe me again.',
			);
			const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
			expect(checkboxes).toHaveLength(2);
			expect(checkboxes.every((input) => !input.includes('checked='))).toBe(
				true,
			);
		}
	});
});

describe('pricing catalog presentation', () => {
	it.each([
		[990, 'USD', '$9.90'],
		[990, 'JPY', '¥990'],
		[990, 'BHD', 'BHD\u00a00.990'],
	] as const)(
		'formats %s minor units in %s without rounding away value',
		(amount, currency, expected) => {
			expect(formatPlanAmount(amount, currency)).toBe(expected);
		},
	);

	it('filters disabled history and selects intervals rather than hardcoded plan IDs', () => {
		const base: PlanDefinition = {
			id: 'custom-month',
			name: 'Custom',
			description: '',
			amount: 990,
			currency: 'USD',
			kind: 'subscription',
			interval: 'month',
			features: [],
		};
		const catalog = [
			base,
			{ ...base, id: 'custom-year', interval: 'year' as const },
			{ ...base, id: 'disabled', disabled: true },
			{
				...base,
				id: 'one-off',
				kind: 'one_time' as const,
				interval: undefined,
			},
		];
		expect(visiblePricingPlans(catalog, false).map((plan) => plan.id)).toEqual([
			'custom-month',
			'one-off',
		]);
		expect(visiblePricingPlans(catalog, true).map((plan) => plan.id)).toEqual([
			'custom-year',
			'one-off',
		]);
	});

  it('renders translated Chinese feature text in the real pricing component', () => {
    overwriteGetLocale(() => 'zh');
    const html = renderToStaticMarkup(createElement(PricingSection));
    expect(html).toContain('按月计费');
    expect(html).not.toContain('Monthly billing');
    expect(html).not.toContain('Everything in Free');
    expect(html).not.toContain('No recurring subscription');
  });

	it('renders exact prices and omits disabled plans and uncomputed savings', () => {
		const monthly = publicPlans.find((plan) => plan.id === 'pro-monthly');
		if (!monthly) throw new Error('Fixture catalog has no monthly plan');
		const { amount, disabled } = monthly;
		try {
			monthly.amount = 990;
			let html = renderToStaticMarkup(createElement(PricingSection));
			expect(html).toContain('$9.90');
			expect(html).not.toContain('Save 17%');
			monthly.disabled = true;
			html = renderToStaticMarkup(createElement(PricingSection));
			expect(html).not.toContain('$9.90');
		} finally {
			monthly.amount = amount;
			monthly.disabled = disabled;
		}
	});
});

describe('safe content rendering', () => {
	it('renders Markdown images and GFM tables with inline formatting and column alignment', () => {
		const html = renderToStaticMarkup(
			createElement(Markdown, {
				content:
					'![Description](/logo.svg "Cover")\n\n| A | B |\n| :--- | ---: |\n| **bold** | [source](https://example.test) |',
			}),
		);
		expect(html).toContain('<img');
		expect(html).toContain('src="/logo.svg"');
		expect(html).toContain('alt="Description"');
		expect(html).toContain('<table>');
		expect(html).toContain('<th scope="col" style="text-align:left">');
		expect(html).toContain('style="text-align:right"');
		expect(html).toContain('<strong>');
		expect(html).toContain('href="https://example.test"');
	});

	it('continues escaping raw HTML and rejects unsafe image and link destinations', () => {
		const html = renderToStaticMarkup(
			createElement(Markdown, {
				content:
					'<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![no](javascript:alert(1))\n\n![no](data:image/svg+xml,test)\n\n![no](https://user:password@example.test/a.png)',
			}),
		);
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
	});

	it('uses configured frontmatter covers in both listing and article', () => {
		const post = { ...getPostBySlug(getSortedPosts('en')[0].slug, 'en') as BlogPost, image: '/custom-cover.png' };
		for (const Component of [BlogCard, BlogArticle] as ComponentType<{ post: BlogPost }>[]) {
			expect(
				renderToStaticMarkup(createElement(Component, { post })),
			).toContain('src="/custom-cover.png"');
			expect(
				renderToStaticMarkup(
					createElement(Component, {
						post: { ...post, image: 'javascript:alert(1)' },
					}),
				),
			).not.toContain('<img');
		}
	});
});

describe('reusable calendar form safety', () => {
	it('renders every date and navigation control as a non-submit button', () => {
		const html = renderToStaticMarkup(
			createElement(
				'form',
				null,
				createElement(Calendar, { selected: new Date(2026, 9, 15) }),
			),
		);
		const buttons = html.match(/<button[^>]*>/g) ?? [];
		expect(buttons).toHaveLength(33);
		expect(buttons.every((button) => button.includes('type="button"'))).toBe(
			true,
		);
	});
});
