import ReactGA from "react-ga4";

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

export const initGA = () => {
  if (GA_MEASUREMENT_ID) {
    ReactGA.initialize(GA_MEASUREMENT_ID);
    console.log("Analytics initialized");
  }
};

export const trackPageView = (path: string) => {
  if (GA_MEASUREMENT_ID) {
    ReactGA.send({ hitType: "pageview", page: path });
  }
};

export const trackEvent = (category: string, action: string, label?: string, value?: number) => {
  if (GA_MEASUREMENT_ID) {
    ReactGA.event({
      category,
      action,
      label,
      value,
    });
  }
};

// Common event categories
export const ANALYTICS_CATEGORIES = {
  SUBJECT: "Subject",
  MODULE: "Module",
  NOTE: "Note",
  MATERIAL: "Material",
  ATTENDANCE: "Attendance",
  GRADE: "Grade",
  AI: "MagicAI",
  STUDENT: "Student",
};

// Common event actions
export const ANALYTICS_ACTIONS = {
  CREATE: "Create",
  EDIT: "Edit",
  DELETE: "Delete",
  VIEW: "View",
  DOWNLOAD: "Download",
  ANALYZE: "Analyze",
  IMPORT: "Import",
};
