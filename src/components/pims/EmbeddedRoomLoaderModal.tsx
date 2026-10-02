import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';

const RoomLoaderPage = lazy(() => import('../../pages/RoomLoader'));

type Props = {
  roomLoaderId: number;
  onClose: () => void;
};

/** Room Loader details modal over the current page — same host the scheduler uses. */
export function EmbeddedRoomLoaderModal({ roomLoaderId, onClose }: Props) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Suspense fallback={null}>
      <RoomLoaderPage embedded={{ roomLoaderId, onClose }} />
    </Suspense>,
    document.body
  );
}
