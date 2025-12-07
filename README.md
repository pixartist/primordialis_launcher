# Primordialis Save Manager & Launcher

A Node.js wrapper for Primordialis that provides save game management functionality.

## Features

- Scans `%appdata%/Primordialis` for save folders
- Interactive save selection menu
- Automatically swaps save folders before launching the game
- Detects when game creates a new save (checks for `world.run` file)
- Prompts to save your game progress after exiting
- Continuous loop for multiple play sessions

## Installation

1. Make sure you have Node.js installed
2. Install dependencies:
```bash
npm install
```

## Building the Executable

To create a standalone .exe file (useful for adding to Steam):

1. Install dependencies (including dev dependencies):
```bash
npm install
```

2. Build the executable:
```bash
npm run build
```

This will create `PrimordialisLauncher.exe` in the current directory.

**Note**: The game path is hardcoded in `launcher-exe.js` as `E:\SteamLibrary\steamapps\common\Primordialis\primordialis.exe`. If your game is in a different location, edit this file before building.

## Usage

### Using the Executable (Recommended)

Simply double-click `PrimordialisLauncher.exe` or add it as a non-Steam game in Steam.

### Using Node.js Directly

Run the launcher with the path to your Primordialis executable:

```bash
node launcher.js "C:\Path\To\Primordialis.exe"
```

### Workflow

1. **Save Selection**: Choose which save folder to load
2. **Game Launch**: The game launches with your selected save
3. **Play**: Play the game normally
4. **Exit Game**: Close the game
5. **Save Check**: If `world.run` exists in the save folder:
   - You'll be prompted to name your save
   - The current save is copied to `save - <your_name>`
6. **Repeat**: Returns to save selection for another session

## Save Folder Structure

The launcher expects save folders in `%appdata%/Primordialis/` with names starting with "save":
- `save` (default save folder)
- `save - my_first_game`
- `save - backup_2024`
- etc.

## Notes

- The default `save` folder is removed and replaced when you select a different save
- Only saves when `world.run` file is detected in the save folder
- You can skip saving by leaving the save name empty
