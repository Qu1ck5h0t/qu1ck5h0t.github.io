function submitForm() {
    const channelid = document.getElementById("channelid").value;
    const token = document.getElementById("token").value;
    const startdate = document.getElementById("startdate").value;
    const enddate = document.getElementById("enddate").value;

    processdates(channelid, token, startdate, enddate);
}

async function processdates(channelid, token, startdate, enddate) {
    let current = new Date(startdate);
    const end = new Date(enddate);

    // Initialize zip object
    const zip = new JSZip();
    let hasMessages = false;

    while (current <= end) {
        // Format YYYY-MM-DD for processday fetching
        const dateStr = current.toISOString().substring(0, 10);

        // Fetch chronological messages for the day
        const dayMessages = await processday(channelid, token, dateStr);

        if (dayMessages && dayMessages.length > 0) {
            hasMessages = true;
            // Format YYYYMMDD filename
            const filename = dateStr.replace(/-/g, '') + '.json';
            // Add the stringified JSON into the ZIP folder under this filename
            zip.file(filename, JSON.stringify(dayMessages, null, 2));
        }

        current.setDate(current.getDate() + 1);
    }

    if (hasMessages) {
        console.log("Generating ZIP file...");
        const content = await zip.generateAsync({ type: "blob" });

        // Trigger download of the zip file
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `discord_messages_${channelid}_${startdate}_to_${enddate}.zip`;

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
        console.log("ZIP download triggered.");
    } else {
        console.log("No messages found in the given date range. No zip generated.");
    }
}

async function processday(channelid, token, day) {
    const DISCORD_EPOCH = 1420070400000n;

    // Parse the target date using explicit local timezone parameters
    // Splitting the string ensures it uses local time, avoiding UTC offset issues
    // Example format: YYYY-MM-DD
    const parts = day.split('-');
    if (parts.length !== 3) {
        console.error("Invalid date format. Expected YYYY-MM-DD, got:", day);
        return [];
    }
    const [year, month, date] = parts;
    const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(date, 10));

    if (isNaN(d.getTime())) {
        console.error("Invalid date values:", day);
        return [];
    }

    // Determine start and end of the day in milliseconds (LOCAL time)
    d.setHours(0, 0, 0, 0);
    const startMs = d.getTime();
    d.setHours(23, 59, 59, 999);
    const endMs = d.getTime();

    // Convert timestamps to Snowflakes to use as boundary IDs
    const minId = ((BigInt(startMs) - DISCORD_EPOCH) << 22n).toString();
    const maxId = ((BigInt(endMs) - DISCORD_EPOCH) << 22n).toString();

    let messages = [];
    let lastId = minId;

    while (true) {
        // Fetch up to 100 messages after the last seen ID
        const url = `https://discord.com/api/v9/channels/${channelid}/messages?after=${lastId}&limit=100`;
        const res = await fetch(url, {
            headers: {
                "Authorization": token
            }
        });

        if (!res.ok) {
            console.error("Error fetching messages:", res.status, res.statusText);
            break;
        }

        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;

        let lastFetchedId = lastId;
        for (const msg of data) {
            const msgId = BigInt(msg.id);
            // Only add messages that fall within our target day
            if (msgId >= BigInt(minId) && msgId <= BigInt(maxId)) {
                messages.push(msg);
            }
            // Track the highest ID observed to paginate forward
            if (msgId > BigInt(lastFetchedId)) {
                lastFetchedId = msg.id;
            }
        }

        // If less than 100 messages returned, we reached the latest available messages
        if (data.length < 100) break;
        // If the newest message in this batch is past the end of the target day
        if (BigInt(lastFetchedId) > BigInt(maxId)) break;
        // Failsafe to prevent an infinite loop
        if (lastFetchedId === lastId) break;

        lastId = lastFetchedId;

        // Handle basic rate limits using response headers if provided
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
            const resetAfter = res.headers.get('x-ratelimit-reset-after');
            if (resetAfter) {
                await new Promise(r => setTimeout(r, parseFloat(resetAfter) * 1000));
            }
        } else {
            // Small delay to prevent spamming
            await new Promise(r => setTimeout(r, 100));
        }
    }

    // Sort messages chronologically by their Snowflake ID (ascending)
    messages.sort((a, b) => {
        const idA = BigInt(a.id);
        const idB = BigInt(b.id);
        if (idA < idB) return -1;
        if (idA > idB) return 1;
        return 0;
    });
    return messages;
}

