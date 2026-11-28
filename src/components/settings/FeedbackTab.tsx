import React, { useState } from "react";
import { CheckCircle2, AlertCircle, Send, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  submitFeedback,
  type FeedbackType,
  type SubmitFeedbackResult,
} from "@/services/feedbackService";

const FEEDBACK_TYPES: Array<{
  id: FeedbackType;
  labelKey: string;
  defaultLabel: string;
}> = [
  {
    id: "bug",
    labelKey: "settings.feedback.types.bug",
    defaultLabel: "Bug Report",
  },
  {
    id: "feature",
    labelKey: "settings.feedback.types.feature",
    defaultLabel: "Feature Request",
  },
  {
    id: "performance",
    labelKey: "settings.feedback.types.performance",
    defaultLabel: "Performance Issue",
  },
  {
    id: "general",
    labelKey: "settings.feedback.types.general",
    defaultLabel: "General Feedback",
  },
];

const DESCRIPTION_MAX = 5000;
const DESCRIPTION_MIN = 5;

export const FeedbackTab: React.FC = () => {
  const { t, language } = useI18n();
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("bug");
  const [description, setDescription] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] =
    useState<SubmitFeedbackResult | null>(null);

  const trimmedDescription = description.trim();
  const canSubmit =
    trimmedDescription.length >= DESCRIPTION_MIN &&
    trimmedDescription.length <= DESCRIPTION_MAX &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await submitFeedback({
        type: feedbackType,
        description: trimmedDescription,
        stepsToReproduce: stepsToReproduce.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        includeDiagnostics,
        locale: language,
      });
      setSubmittedResult(result);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : t("settings.feedback.errors.submitFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedResult(null);
    setDescription("");
    setStepsToReproduce("");
    setErrorMessage(null);
  };

  if (submittedResult) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 px-4 max-w-md mx-auto gap-4">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-text-primary">
            {t("settings.feedback.success.title")}
          </h3>
          <p className="text-xs text-text-muted leading-relaxed">
            {t("settings.feedback.success.description")}
          </p>
          {submittedResult.id && (
            <p className="text-[11px] font-mono text-text-muted pt-1">
              {t("settings.feedback.success.referenceId")}: {submittedResult.id}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary transition-colors cursor-pointer"
        >
          {t("settings.feedback.success.sendAnother")}
        </button>
      </div>
    );
  }

  const descriptionPlaceholder =
    feedbackType === "bug"
      ? t("settings.feedback.placeholders.bug")
      : feedbackType === "feature"
        ? t("settings.feedback.placeholders.feature")
        : feedbackType === "performance"
          ? t("settings.feedback.placeholders.performance")
          : t("settings.feedback.placeholders.general");

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-text-primary tracking-tight">
          {t("settings.feedback.title")}
        </h3>
        <p className="text-xs text-text-muted mt-1 leading-relaxed">
          {t("settings.feedback.subtitle")}
        </p>
      </div>

      {/* Feedback Type */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-text-primary mb-2">
          {t("settings.feedback.typeLabel")}
        </legend>
        <div className="space-y-2" role="radiogroup" aria-label={t("settings.feedback.typeLabel")}>
          {FEEDBACK_TYPES.map((item) => {
            const isSelected = feedbackType === item.id;
            return (
              <label
                key={item.id}
                className="flex items-center gap-2.5 cursor-pointer text-xs sm:text-[13px] text-text-primary select-none"
              >
                <input
                  type="radio"
                  name="feedbackType"
                  value={item.id}
                  checked={isSelected}
                  onChange={() => setFeedbackType(item.id)}
                  className="h-4 w-4 accent-accent-primary cursor-pointer"
                />
                <span className={isSelected ? "font-medium text-text-primary" : "text-text-muted"}>
                  {t(item.labelKey) || item.defaultLabel}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Description */}
      <div className="space-y-2">
        <label
          htmlFor="clypra-feedback-description"
          className="block text-xs font-semibold text-text-primary"
        >
          {t("settings.feedback.descriptionLabel")}
        </label>
        <p className="text-xs text-text-muted leading-relaxed">
          {t("settings.feedback.descriptionHint")}
        </p>
        <ul className="list-disc list-inside text-[11px] text-text-muted space-y-0.5 pl-1">
          <li>{t("settings.feedback.hints.steps")}</li>
          <li>{t("settings.feedback.hints.expected")}</li>
          <li>{t("settings.feedback.hints.actual")}</li>
          <li>{t("settings.feedback.hints.media")}</li>
        </ul>
        <textarea
          id="clypra-feedback-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={descriptionPlaceholder}
          rows={5}
          maxLength={DESCRIPTION_MAX}
          required
          className="w-full rounded-xl bg-surface-input border border-border-default px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/40 resize-y transition-colors"
        />
        <div className="flex justify-between text-[11px] text-text-muted">
          <span>
            {trimmedDescription.length > 0 && trimmedDescription.length < DESCRIPTION_MIN
              ? t("settings.feedback.errors.tooShort")
              : ""}
          </span>
          <span className="font-mono">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
      </div>

      {/* Steps to Reproduce */}
      {(feedbackType === "bug" || feedbackType === "performance") && (
        <div className="space-y-1.5">
          <label
            htmlFor="clypra-feedback-steps"
            className="block text-xs font-semibold text-text-primary"
          >
            {t("settings.feedback.stepsLabel")}
          </label>
          <textarea
            id="clypra-feedback-steps"
            value={stepsToReproduce}
            onChange={(e) => setStepsToReproduce(e.target.value)}
            placeholder={t("settings.feedback.placeholders.steps")}
            rows={3}
            maxLength={DESCRIPTION_MAX}
            className="w-full rounded-xl bg-surface-input border border-border-default px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/40 resize-y transition-colors"
          />
        </div>
      )}

      {/* Optional Contact Email */}
      <div className="space-y-1.5">
        <label
          htmlFor="clypra-feedback-email"
          className="block text-xs font-semibold text-text-primary"
        >
          {t("settings.feedback.emailLabel")}
        </label>
        <input
          id="clypra-feedback-email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={t("settings.feedback.placeholders.email")}
          maxLength={254}
          className="w-full rounded-xl bg-surface-input border border-border-default px-3.5 py-2 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/40 transition-colors"
        />
      </div>

      {/* Include Diagnostics Checkbox */}
      <label className="flex items-start gap-2.5 cursor-pointer rounded-xl bg-surface-card border border-border-default/70 p-3">
        <input
          type="checkbox"
          checked={includeDiagnostics}
          onChange={(e) => setIncludeDiagnostics(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-accent-primary cursor-pointer"
        />
        <span className="text-[11px] leading-relaxed text-text-muted">
          <span className="block font-medium text-text-primary text-xs">
            {t("settings.feedback.includeDiagnosticsLabel")}
          </span>
          {t("settings.feedback.includeDiagnosticsDescription")}
        </span>
      </label>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-end pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-accent-primary text-white hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
        >
          {isSubmitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>
            {isSubmitting
              ? t("settings.feedback.submitting")
              : t("settings.feedback.submit")}
          </span>
        </button>
      </div>
    </form>
  );
};
