var colors = {
    "light-blue": "#f0f4fc",
    "light-green": "#ecfcf1",
    "light-cyan": "#cff5fa",
    "light-orange": "#fffbf0",
    "light-yellow": "#fffbf0",
    "light-red": "#fff2f0",
    "light-brown": "#f5e6dc",
    "light-purple": "#f9f1fd",
    "light-pink": "#f7e1f2",
    "light-gray": "#f5f5f5",
    "blue": "#dae4fd",
    "green": "#d0f6dc",
    "cyan": "#a0ebf5",
    "orange": "#fff4da",
    "yellow": "#ffe9b4",
    "red": "#ffdeda",
    "brown": "#f5ceb0",
    "purple": "#dfb9f7",
    "pink": "#f7b2e7",
    "gray": "#d7d8d9",
    "dark-blue": "#acc8f8",
    "dark-green": "#a0eeba",
    "dark-cyan": "#70e0ef",
    "dark-orange": "#ffe9b4",
    "dark-yellow": "#ffdd8f",
    "dark-red": "#ffbdb4",
    "dark-brown": "#f5c098",
    "dark-purple": "#cf96f2",
    "dark-pink": "#f285d9",
    "dark-gray": "#cdcecd",
    "darker-blue": "#689ef1",
    "darker-green": "#41dd75",
    "darker-cyan": "#41d6ea",
    "darker-orange": "#ffd269",
    "darker-yellow": "#ffd269",
    "darker-red": "#ff7b69",
    "darker-brown": "#f5a96e",
    "darker-purple": "#bf73ee",
    "darker-pink": "#ff6dde",
    "darker-gray": "#b5b5b7",
    "deep-dark-green": "#10bf4a",
    "deep-dark-orange": "#ffc744",
    "white": "#fff"
  }
var base_html = "<div style='display:flex; white-space: normal; align-items:center'>";
var close_html = '</div>';
var get_base_array_html = (value, color)=>{
	return "<div style=\"background-color: " + (color && colors[color] ? colors[color] : 'lightgrey') + ";border-radius: 10px; padding-left: 10px; padding-top: 4px; padding-bottom: 4px; width: fit-content; padding-right: 10px; margin-top: 3px;\">" + 
		value + 
	"</div>";
}
var get_base_btn_html = (url, label, color)=>{
	return "<div style=\"background-color: " + (color && colors[color] ? colors[color] : 'lightgrey') + ";border-radius: 10px; padding-left: 10px; padding-top: 4px; padding-bottom: 4px; width: fit-content; padding-right: 10px; margin-top: 3px; cursor:pointer\">" + 
		"<a  href=\"" + url + "\" target=\"_blank\">" + label + "</a>"+
	"</div>";
}
var get_base_array_image_html = (url)=>{
	return "<img style='width: 100%; margin-top: 5px; margin-bottom: 5px; border-radius: 3px; box-shadow: 0px 8px 9px -4px rgba(0,0,0,0.73);' src=\"" + url + "\" ></img>";
}
var get_base_array_link_html = (url, visibleName)=>{
	return "<p style='background-color : lightgray;' ><a  href=\"" + url + "\" target=\"_blank\" download=\""+visibleName+"\">" + visibleName + "</a></p>"
}
var computeAnyType = (element, nested)=>{
	var value;
	var innerHtml = "";
	if(Array.isArray(element)){
		value = [];
		element.forEach((arrayItem)=>{
			var result = computeAnyType(arrayItem, true);
			value.push(result.value);
			innerHtml += result.innerHtml;
		});
		//innerHtml += close_html;
	}
	else if(typeof element == "object"){
		if(element.value != undefined && typeof element.value == "object"){
			var result = computeAnyType(element.value, true);
			innerHtml = result.innerHtml;
			value = result.value;
		}
		else if(element.value != undefined){
			innerHtml = get_base_array_html(element.value, element.color); // + close_html;
			value = element;
		}
		else if(element.name != undefined && element.is_image == undefined && element.url == undefined) {
			innerHtml = get_base_array_html(element.name, element.color); // + close_html;
			value = element;
		}
		else if(element.url != undefined && element.label != undefined && element.is_image == undefined){
			innerHtml = get_base_btn_html(element.url, element.label, "light-blue"); // + close_html;
			value = element;
		}
		else if(element.is_image != undefined){
			if(element.is_image == true){
				innerHtml = get_base_array_image_html(element.url); // + close_html;
			}
			else{
				innerHtml = get_base_array_link_html(element.url, element.visible_name); // + close_html;
			}
			value = element;
		}
		else{
			log.warn("type not handled");
		}
	}
	else{
		innerHtml = element; // + close_html;
		value = element;
	}
	return {innerHtml: innerHtml + (nested ? "" : close_html), value: value};
}