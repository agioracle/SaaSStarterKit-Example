import {
	ArrowDown,
	ArrowRight,
	ArrowUpRight,
	Check,
	Layers3,
	LockKeyhole,
	SlidersHorizontal,
	Sparkles,
} from "lucide-react";
import { localePath } from "../../locale";
import { AbstractArt } from "./art";
import { l, promptText } from "./copy";
export function LandingPage() {
	return (
		<div className="lm-landing">
			<section className="lm-hero container">
				<div className="lm-hero-copy">
					<span className="lm-kicker">
						<span /> {l("a_little_imagination_a_new_perspective")}
					</span>
					<h1>
						{l("give_your_ideas")}
						<br />
						<em>{l("a_place_to_begin")}</em>
					</h1>
					<p>
						{l(
							"turn_the_picture_in_your_mind_into_something_you_can_see_an_unhurried_",
						)}
					</p>
					<div className="lm-hero-actions">
						<a href={localePath("/studio")} className="button primary">
							{l("start_creating")}
							<ArrowUpRight size={17} />
						</a>
						<a href="#how-it-works" className="lm-text-link">
							{l("a_look_inside")}
							<ArrowDown size={15} />
						</a>
					</div>
					<div className="lm-hero-note">
						<LockKeyhole size={13} />
						{l("a_private_workspace_your_ideas_stay_yours")}
					</div>
				</div>
				<figure className="lm-hero-art">
					<AbstractArt />
					<div className="lm-art-tag">
						<Sparkles size={14} />
						<span>{l("a_study_in_possibility")}</span>
					</div>
					<figcaption>
						<span>01 / LUMINA STUDIES</span>
						<span>{l("original_illustration_not_ai_output")}</span>
					</figcaption>
				</figure>
			</section>
			<div className="lm-provider-strip container">
				<span>{l("two_ways_to_bring_an_idea_to_life")}</span>
				<div>
					<strong>
						<span className="lm-provider-icon">☁</span> Cloudflare Workers AI
					</strong>
					<span className="lm-strip-divider" />
					<strong>
						<span className="lm-fal-mark">f</span> fal.ai
					</strong>
				</div>
				<small>
					{l("available_when_configured_by_your_workspace_operator")}
				</small>
			</div>
			<section className="lm-section container" id="features">
				<div className="lm-section-heading">
					<div>
						<span className="lm-kicker">{l("less_friction_more_feeling")}</span>
						<h2>
							{l("from_a_passing_thought")}
							<br />
							<em>{l("to_something_worth_keeping")}</em>
						</h2>
					</div>
					<p>
						{l(
							"just_the_tools_you_need_with_room_for_your_own_creative_process_no_bus",
						)}
					</p>
				</div>
				<div className="lm-features">
					{[
						{
							Icon: Sparkles,
							num: "01",
							title: l("start_with_your_words"),
							text: l(
								"describe_a_feeling_a_scene_a_tiny_detail_shape_your_direction_with_tho",
							),
						},
						{
							Icon: SlidersHorizontal,
							num: "02",
							title: l("find_your_point_of_view"),
							text: l(
								"choose_a_provider_and_the_settings_your_model_actually_supports_clear_",
							),
						},
						{
							Icon: LockKeyhole,
							num: "03",
							title: l("keep_the_good_things"),
							text: l(
								"your_images_and_prompts_stay_together_in_a_private_library_ready_to_do",
							),
						},
					].map(({ Icon, num, title, text }) => (
						<article className="lm-feature" key={num}>
							<div>
								<span className="lm-feature-icon">
									<Icon size={22} strokeWidth={1.5} />
								</span>
								<span className="lm-number">{num}</span>
							</div>
							<h3>{title}</h3>
							<p>{text}</p>
						</article>
					))}
				</div>
			</section>
			<section className="lm-inspiration" id="how-it-works">
				<div className="container lm-inspiration-grid">
					<div>
						<span className="lm-kicker">
							{l("a_small_spark_goes_a_long_way")}
						</span>
						<h2>
							{l("what_will_you")}
							<br />
							<em>{l("imagine_today")}</em>
						</h2>
						<p>
							{l(
								"a_quiet_still_life_a_world_that_doesn_t_exist_something_you_don_t_have",
							)}
						</p>
						<a href={localePath("/studio")} className="lm-text-link">
							{l("open_your_studio")}
							<ArrowRight size={17} />
						</a>
					</div>
					<div className="lm-idea-cards">
						{(["orbit", "bloom"] as const).map((variant, i) => (
							<a
								className="lm-idea-card"
								href={`${localePath("/studio")}?idea=${i + 1}`}
								key={variant}
							>
								<AbstractArt variant={variant} />
								<div>
									<span>
										{i === 0
											? l("objects_of_curiosity")
											: l("a_softer_kind_of_world")}
									</span>
									<ArrowUpRight size={16} />
								</div>
								<p>{promptText(i + 1)}</p>
								<small>{l("illustration_click_to_try_this_prompt")}</small>
							</a>
						))}
					</div>
				</div>
			</section>
			<section className="lm-section container lm-workflow">
				<div className="lm-section-heading">
					<div>
						<span className="lm-kicker">{l("thoughtfully_simple")}</span>
						<h2>
							{l("your_process_with")}
							<br />
							<em>{l("a_little_more_flow")}</em>
						</h2>
					</div>
				</div>
				<div className="lm-workflow-grid">
					{[
						[
							l("describe_it"),
							l(
								"write_a_prompt_and_select_your_model_start_with_a_preset_if_the_blank_",
							),
						],
						[
							l("make_space_for_it"),
							l(
								"follow_the_real_job_status_without_invented_progress_bars_your_request",
							),
						],
						[
							l("make_it_yours"),
							l(
								"download_the_finished_image_or_reuse_its_prompt_for_a_fresh_direction_",
							),
						],
					].map(([title, text], i) => (
						<div key={title}>
							<span className="lm-step">0{i + 1}</span>
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					))}
				</div>
			</section>
			<section className="lm-final container">
				<span className="lm-final-star" aria-hidden="true">
					✳
				</span>
				<span className="lm-kicker">{l("the_next_good_idea_is_yours")}</span>
				<h2>
					{l("a_blank_canvas")}
					<br />
					<em>{l("an_open_invitation")}</em>
				</h2>
				<a href={localePath("/studio")} className="button primary">
					{l("make_something_with_lumina")}
					<ArrowUpRight size={17} />
				</a>
				<p>
					<Check size={13} />
					{l("private_library")}
					<span /> <Layers3 size={13} />
					{l("two_model_providers")}
				</p>
			</section>
		</div>
	);
}
