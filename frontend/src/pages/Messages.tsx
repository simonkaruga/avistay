import { useParams } from "react-router-dom";
import { useSEO } from "../utils/seo";
import MessageThread from "../components/MessageThread";

/** /messages/:bookingId: a guest's conversation with their host. */
export default function Messages() {
  const { bookingId } = useParams<{ bookingId: string }>();
  useSEO({ title: "Messages", noIndex: true });
  return <div className="pt-header bg-(--bg-primary)"><MessageThread bookingId={bookingId!} backTo="/bookings" /></div>;
}
