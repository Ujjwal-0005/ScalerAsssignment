const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const { redactDocx } = require("./src/redact_pii");

const app = express();
const PORT = process.env.PORT || 3000;

// Store uploaded files temporarily
const upload = multer({
    dest: path.join(__dirname, "tmp")
});

// Basic health check
app.get("/", (req, res) => {
    res.json({
        name: "PII Redaction Tool",
        status: "running",
        description: "Node.js API for detecting and replacing PII in DOCX files"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy"
    });
});

// Redaction endpoint
app.post("/redact", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: "Please upload a DOCX file using the 'file' field."
        });
    }

    const inputPath = req.file.path;

    const outputDir = path.join(__dirname, "tmp");
    const outputPath = path.join(
        outputDir,
        `redacted-${Date.now()}.docx`
    );

    try {
        // Make sure the uploaded file is a DOCX
        if (
            req.file.mimetype !==
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
            fs.unlinkSync(inputPath);

            return res.status(400).json({
                error: "Only DOCX files are supported."
            });
        }

        // Run the existing PII redaction engine
        const result = redactDocx(
            inputPath,
            outputPath
        );

        // Count detections by type
        const counts = {};

        for (const detection of result.detections) {
            counts[detection.label] =
                (counts[detection.label] || 0) + 1;
        }

        // Send the generated DOCX back
        res.download(
            outputPath,
            "redacted_output.docx",
            {
                headers: {
                    "X-PII-Detections": JSON.stringify(counts)
                }
            },
            (error) => {
                // Cleanup temporary files
                try {
                    if (fs.existsSync(inputPath)) {
                        fs.unlinkSync(inputPath);
                    }

                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }
                } catch (cleanupError) {
                    console.error(
                        "Cleanup error:",
                        cleanupError.message
                    );
                }

                if (error) {
                    console.error(
                        "Download error:",
                        error.message
                    );
                }
            }
        );

    } catch (error) {
        console.error("Redaction error:", error);

        // Cleanup uploaded file
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }

        res.status(500).json({
            error: "PII redaction failed.",
            message: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`PII Redaction API running on port ${PORT}`);
});