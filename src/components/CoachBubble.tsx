import type { ReactNode } from 'react';
import type { Classification } from '../lib/analysis/types';
import { ClassIcon } from './ClassIcon';
import { pieceUrl } from './Board';

export function CoachAvatar({ pieceSet }: { pieceSet: string }) {
  return (
    <div className="coach-avatar" aria-hidden>
      <span style={{ backgroundImage: `url(${pieceUrl(pieceSet, 'w', 'n')})` }} />
    </div>
  );
}

interface Props {
  pieceSet: string;
  classification?: Classification | null;
  title?: ReactNode;
  evalText?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}

/** The coach's speech bubble: verdict, evaluation and a few plain sentences. */
export function CoachBubble({ pieceSet, classification, title, evalText, children, actions }: Props) {
  return (
    <div className="coach">
      <CoachAvatar pieceSet={pieceSet} />
      <div className="bubble" aria-live="polite">
        {(title || evalText) && (
          <div className="bubble-head">
            {classification && <ClassIcon c={classification} size={22} />}
            <span className="bubble-title">{title}</span>
            {evalText && <span className="bubble-eval">{evalText}</span>}
          </div>
        )}
        {children && <div className="bubble-body">{children}</div>}
        {actions && <div className="bubble-actions">{actions}</div>}
      </div>
    </div>
  );
}
