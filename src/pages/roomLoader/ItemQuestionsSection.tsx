// src/pages/roomLoader/ItemQuestionsSection.tsx
// Questions the practice asks about something already on the estimate — which form of a
// vaccine the owner prefers, whether to book the booster after a first dose. The answer
// is recorded for staff; it never changes what is on the estimate.
import type { RoomLoaderItemQuestion } from '../../utils/roomLoaderConfigTypes';
import { fillPetName } from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import { itemQuestionKey } from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

type Props = {
  petKey: string;
  petName: string;
  questions: RoomLoaderItemQuestion[];
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
};

export default function ItemQuestionsSection({
  petKey,
  petName,
  questions,
  formData,
  onChange,
  errors = {},
  disabled = false,
}: Props) {
  if (questions.length === 0) return null;

  return (
    <>
      {questions.map((question) => {
        const key = itemQuestionKey(petKey, question.id);
        const answer = String(formData[key] ?? '');
        const prompt = fillPetName(question.questionText, petName);
        const error = errors[key];
        return (
          <section className="rl-askq" key={question.id}>
            <h3 className="rl-askq__title">
              {prompt}
              {question.required ? <span className="rl-required"> *</span> : null}
            </h3>
            {question.helpHtml ? <RoomLoaderHtml html={fillPetName(question.helpHtml, petName)} /> : null}
            <div className="rl-choices" role="radiogroup" aria-label={prompt}>
              {question.choices.map((choice) => (
                <label key={choice.id} className={answer === choice.id ? 'is-selected' : undefined}>
                  <input
                    type="radio"
                    name={key}
                    value={choice.id}
                    checked={answer === choice.id}
                    disabled={disabled}
                    onChange={() => onChange(key, choice.id)}
                  />
                  <span>{fillPetName(choice.label, petName)}</span>
                </label>
              ))}
            </div>
            {error ? <p className="rl-askq__error">{error}</p> : null}
          </section>
        );
      })}
    </>
  );
}
