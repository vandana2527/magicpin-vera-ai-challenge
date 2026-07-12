# A Simple Guide to Run Your Vera AI Bot

Welcome! If you are new to coding, don't worry. This guide is written in very simple language. It will show you exactly what to do step-by-step.

---

## What do you need before starting?
1. **Gemini API Key**: This is a password that lets the bot use Google's smart AI to write messages.
2. **VS Code** (the program you are using to look at these files).

---

## Step 1: Get a Free Gemini API Key
If you do not have an API key yet:
1. Open your web browser (like Chrome).
2. Go to this website: **[Google AI Studio](https://aistudio.google.com/)**
3. Log in with your normal Google Account (Gmail).
4. Click the blue button that says **"Get API key"** (usually at the top left).
5. Click **"Create API Key"**, choose the default option, and copy the long code it gives you. It looks like a mix of letters and numbers (for example: `AIzaSyB123...`).

---

## Step 2: Put the Key in the `.env` File
The `.env` file is where we store our passwords.

1. In VS Code, look at the left side of your screen (where your files are listed).
2. Find the file named **`.env`** and click it to open it.
3. You will see this line on line 3:
   `GEMINI_API_KEY=`
4. Paste your API key right after the `=` sign. For example:
   `GEMINI_API_KEY=AIzaSyYourKeyHere`
5. Save the file by pressing **Ctrl + S** on your keyboard (or Cmd + S if you are on a Mac).

---

## Step 3: Start the Bot (The Express Server)
*Note: The bot is already running in the background for this session. But if you need to start it yourself later, follow these steps:*

1. In VS Code, go to the top menu and click **Terminal** -> **New Terminal**. A black window will open at the bottom of your screen.
2. Type this command in that black window and press Enter:
   ```bash
   npm start
   ```
3. You will see a text saying: `Server listening on port 8080`.
4. Keep this terminal open. Do not close it!

---

## Step 4: Open Your Dashboard (The Website)
We built a beautiful webpage to see what the bot is doing.

1. Open your web browser (Chrome, Edge, or Firefox).
2. Type this address in the top bar: **[http://localhost:8080](http://localhost:8080)** and press Enter.
3. You will see the **Vera Operator Dashboard** webpage on your screen. 
4. The dashboard will show `0` under Categories, Merchants, etc. This is normal because we haven't loaded any data yet.

---

## Step 5: Run the Scoring Test (The Judge Simulator)
Now we will run a test script that loads data into your bot and scores how smart it is.

1. In VS Code, open a **new separate terminal** by clicking the **`+` icon** on the right side of the terminal panel (next to where it says "node" or "bash"). This opens a clean terminal screen.
2. Paste this command in the terminal and press Enter to save your key in the terminal's memory (replace `AIzaSyYourKeyHere` with your actual key):
   ```powershell
   $env:GEMINI_API_KEY="AIzaSyYourKeyHere"
   ```
3. Type this second command and press Enter to start the test:
   ```powershell
   python judge_simulator.py
   ```
4. Watch the screen! You will see the test loading merchants, sending test messages, and giving you scores out of 10.

---

## Step 6: Test it in Your Browser
1. Go back to your browser page (**http://localhost:8080**).
2. **Refresh the page** (press F5 or click the reload circle).
3. Under **Select Merchant**, click the dropdown and choose a business (like *Asha Dental Care*).
4. Under **Select Trigger Type**, choose an event (like *Recall Due*).
5. Click the purple button: **Simulate Composition**.
6. Under **Output Message Preview**, you will see the exact WhatsApp message the AI composed for that business!
