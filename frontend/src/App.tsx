import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Property from "./pages/Property";
import Booking from "./pages/Booking";
import BookingConfirm from "./pages/BookingConfirm";
import Saved from "./pages/Saved";
import Bookings from "./pages/Bookings";
import Profile from "./pages/Profile";
import TopBar from "./components/TopBar";
import SiteNotice from "./components/SiteNotice";
import BottomNav from "./components/BottomNav";
import NotFound from "./pages/NotFound";
import Legal from "./pages/Legal";
import HowItWorks from "./pages/HowItWorks";
import About from "./pages/About";
import OwnerApply from "./pages/OwnerApply";
import ResetPassword from "./pages/ResetPassword";

// Not needed by most visitors — keep them out of the main bundle.
const Dispute = lazy(() => import("./pages/Dispute"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const OwnerLayout = lazy(() => import("./pages/owner/OwnerLayout"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const PlaceGuide = lazy(() => import("./pages/PlaceGuide"));
const PhotoCredits = lazy(() => import("./pages/PhotoCredits"));
const AgentLayout = lazy(() => import("./pages/agent/AgentLayout"));

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      {/* Guest portal */}
      <Route
        path="/*"
        element={
          <>
            <SiteNotice />
            <TopBar />
            <Routes>
              <Route path="/"                          element={<Home />} />
              <Route path="/search"                    element={<Search />} />
              <Route path="/property/:id"              element={<Property />} />
              <Route path="/photo-credits"             element={<Suspense fallback={null}><PhotoCredits /></Suspense>} />
              <Route path="/places/:slug"              element={<Suspense fallback={null}><PlaceGuide /></Suspense>} />
              <Route path="/booking/:id"               element={<Booking />} />
              <Route path="/booking-confirm/:bookingId" element={<BookingConfirm />} />
              <Route path="/saved"                     element={<Saved />} />
              <Route path="/bookings"                  element={<Bookings />} />
              <Route path="/profile"                   element={<Profile />} />
              <Route path="/terms"                     element={<Legal page="terms" />} />
              <Route path="/privacy"                   element={<Legal page="privacy" />} />
              <Route path="/cancellation-policy"       element={<Legal page="cancellation" />} />
              <Route path="/how-it-works"              element={<HowItWorks />} />
              <Route path="/about"                     element={<About />} />
              <Route path="/list-your-property"        element={<OwnerApply />} />
              <Route path="/reset-password"            element={<ResetPassword />} />
              <Route path="/delete-account"            element={<Suspense fallback={null}><DeleteAccount /></Suspense>} />
              <Route path="/disputes/:id"              element={<Suspense fallback={null}><Dispute /></Suspense>} />
              <Route path="*"                          element={<NotFound />} />
            </Routes>
            <BottomNav />
            <InstallPrompt />
          </>
        }
      />

      {/* Owner portal — completely separate UI */}
      <Route path="/owner/*" element={<Suspense fallback={null}><OwnerLayout /></Suspense>} />

      {/* Admin portal — founder only */}
      <Route path="/admin/*" element={<Suspense fallback={null}><AdminLayout /></Suspense>} />

      {/* Agent / broker portal */}
      <Route path="/agent/*" element={<Suspense fallback={null}><AgentLayout /></Suspense>} />
    </Routes>
    </ErrorBoundary>
  );
}
