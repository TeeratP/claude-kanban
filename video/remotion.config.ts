import { Config } from '@remotion/cli/config'

// Remotion's own headless browser can't be downloaded here; render with the
// installed Google Chrome instead.
Config.setBrowserExecutable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
