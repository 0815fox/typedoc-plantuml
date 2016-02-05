var encoder = require("plantuml-encoder");
var plantuml = require("node-plantuml");
var path = require("path");
var fs = require("fs");

function plugin (app, td, cb) {

    var umlExpression = /<uml(?:\s+alt\s*=\s*['"](.+)['"]\s*)?>([\s\S]*?)<\/uml>/gi,
        encodedUmlExpression = /<img src="http:\/\/www.plantuml.com\/plantuml\/(?:img|png|svg)\/([^"]*)"(?: alt="(.+)")?>/g,
        outputDirectory,
        server = "http://www.plantuml.com/plantuml/",
        format,
        location;

    // setup options
    app.on(td.Application.EVENT_COLLECT_PARAMETERS, function (parser) {
        parser.addParameter({
            name: 'umlLocation',
            help: 'local|remote',
            defaultValue: 'local'
        });
        parser.addParameter({
            name: 'umlFormat',
            help: 'png|svg',
            defaultValue: 'png'
        });
    });

    // on resolve replace uml blocks with image link to encoded uml data
    app.converter.on(td.converter.Converter.EVENT_RESOLVE_BEGIN, function (context) {

        // ensure valid format
        format = app.options.umlFormat;
        if(format) {
            format = format.toLowerCase();
        }
        if(format != "png" && format != "svg") {
            format = "png";
        }

        // ensure valid location
        location = app.options.umlLocation;
        if(location) {
            location = location.toLowerCase();
        }
        if(location != "local" && location != "remote") {
            location = "local";
        }

        var project = context.project;

        // go though all the comments
        for (var key in project.reflections) {
            var reflection = project.reflections[key];

            if(reflection.comment) {
                var text = reflection.comment.text,
                    match,
                    index = 0,
                    segments = [];

                // if we have comment body text look for uml blocks
                if(text) {
                    while ((match = umlExpression.exec(text)) != null) {

                        segments.push(text.substring(index, match.index));

                        // replace the uml block with a link to plantuml.com with the encoded uml data
                        if (match[2]) {
                            segments.push("![");
                            if (match[1]) {
                                // alternate text
                                segments.push(match[1]);
                            }
                            segments.push("](" + server + format + "/");
                            segments.push(encoder.encode(match[2]));
                            segments.push(")");
                        }

                        index = match.index + match[0].length;
                    }

                    // write modified comment back
                    if(segments.length > 0) {
                        segments.push(text.substring(index, text.length));
                        reflection.comment.text = segments.join("");
                    }
                }
            }
        }
    });

    // get the output directory
    app.renderer.on(td.output.Renderer.EVENT_BEGIN, function(event) {

        outputDirectory = path.join(event.outputDirectory, "assets/images/");
    });

    // on render replace the external urls with local ones
    app.renderer.on(td.output.Renderer.EVENT_END_PAGE, function(page) {

        // rewrite the image links to: 1) generate local images, 2) transform to <object> tag for svg, 3) add css class
        var contents = page.contents,
            index = 0,
            match,
            segments = [],
            started = 0;

        if (contents) {
            while ((match = encodedUmlExpression.exec(contents)) != null) {

                segments.push(contents.substring(index, match.index));

                // get the image source
                var src = match[1],
                    alt = match[2];

                // decode image and write to disk if using local images
                if (location == "local") {
                    // keep track of how many images are still being written to disk
                    started++;
                    src = writeLocalImage(page.filename, src, function () {
                        started--;
                        if (started == 0 && match == null && cb) {
                            cb();
                        }
                    });
                }
                else {
                    // this is the case where we have a remote file, so we don't need to write out the image but
                    // we need to add the server back into the image source since it was removed by the regex
                    src = server + format + "/" + src;
                }

                // re-write image tag
                if (format == "png") {
                    segments.push("<img class=\"uml\" src=");
                    // replace external path in content with path to image to assets directory
                    segments.push("\"" + src + "\"");
                    if (alt) {
                        segments.push(" alt=\"" + alt + "\"");
                    }
                    segments.push(">");
                }
                else {
                    segments.push("<object type=\"image/svg+xml\" class=\"uml\" data=\"");
                    segments.push(src);
                    segments.push("\">");
                    if (alt) {
                        segments.push(alt);
                    }
                    segments.push("</object>");
                }

                index = match.index + match[0].length;
            }

            // write modified contents back to page
            if (segments.length > 0) {
                segments.push(contents.substring(index, contents.length));
                page.contents = segments.join("");
            }
        }

        // if local images were not generated then call the callback now if we have one
        if(location == "remote" && cb) {
            setTimeout(cb, 0);
        }
    });

    // the uml image number
    var num = 0;

    function writeLocalImage(pageFilename, src, cb) {

        // setup plantuml encoder and decoder
        var decode = plantuml.decode(src);
        var gen = plantuml.generate({format: format});

        // get image filename
        var filename = "uml" + (++num) + "." + format;
        var imagePath = path.join(outputDirectory, filename);

        // decode and save png to assets directory
        decode.out.pipe(gen.in);
        gen.out.pipe(fs.createWriteStream(imagePath));
        gen.out.on('finish', cb);

        // get relative path filename
        var currentDirectory = path.dirname(pageFilename);
        // return the relative path
        return path.relative(currentDirectory, imagePath);
    }
}

module.exports = plugin;