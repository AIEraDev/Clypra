import { commonMessages } from "./common";
import { editorMessages } from "./editor";
import { featureMessages } from "./features";
import { propertyMessages } from "./properties";
import { settingsMessages } from "./settings";
import { shellMessages } from "./shell";
import { systemMessages } from "./system";
import { timelineMessages } from "./timeline";

export const messages = {
  ...commonMessages,
  ...shellMessages,
  ...settingsMessages,
  ...editorMessages,
  ...featureMessages,
  ...propertyMessages,
  ...timelineMessages,
  ...systemMessages,
};
