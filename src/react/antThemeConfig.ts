import { ThemeConfig } from "antd";
import { motionEnabled } from "./util/motion.ts";

export const antThemeConfig: ThemeConfig = {
  token: {
    controlHeight: 28,
    // antd animates its own widgets (waves, dropdowns). The same preference that zeroes our
    // CSS durations has to zero those, or the reduced-motion promise is only half true.
    motion: motionEnabled(),
  },
  components: {
    Button: {
      paddingInline: 8,
    },
  },
};
