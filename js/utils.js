var colors = {
      "light-green"  :  "#e6fff1",
      "light-blue"   :  "#ebf7ff",
      "light-orange" :  "#fff6e6", 
      "light-red"	 :  "#ffe8e6",
      "light-gray"	 :  "#f5f5f5",

      "green"  		 :  "#bdffdc",
      "blue"   		 :  "#b5dbf5",
      "orange" 		 :  "#ffe9c2",
      "red"	 		 :  "#ffbfb8",
      "gray"	 	 :  "#d9dbde",

      "dark-green"   :  "#9bf2c4",
      "dark-blue"    :  "#83c3eb",
      "dark-orange"  :  "#ffe0ab",
      "dark-red"	 :  "#f7a499",
      "dark-gray"	 :  "#b4bac2"
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
		"<a  src=\"" + url + "\" >" + label + "</a>"+
	"</div>";
}
var get_base_array_image_html = (url)=>{
	return "<img style='width: 100%; margin-top: 5px; margin-bottom: 5px; border-radius: 3px; box-shadow: 0px 8px 9px -4px rgba(0,0,0,0.73);' src=\"" + url + "\" ></img>";
}
var get_base_array_link_html = (url, visibleName)=>{
	return "<p style='background-color : lightgray;' ><a  src=\"" + url + "\" >" + visibleName + "</a></p>"
}
var computeAnyType = (element)=>{
	var value;
	var innerHtml = "";
	if(Array.isArray(element)){
		value = [];
		element.forEach((arrayItem)=>{
			var result = computeAnyType(arrayItem);
			value.push(result.value);
			innerHtml += result.innerHtml;
		});
		innerHtml += close_html;
	}
	else if(typeof element == "object"){
		if(element.value != undefined && typeof element.value == "object"){
			var result = computeAnyType(element.value);
			innerHtml = result.innerHtml;
			value = result.value;
		}
		else if(element.value != undefined){
			innerHtml = get_base_array_html(element.value, element.color) + close_html;
			value = element;
		}
		else if(element.name != undefined && element.is_image == undefined && element.url == undefined) {
			innerHtml = get_base_array_html(element.name, element.color) + close_html;
			value = element;
		}
		else if(element.url != undefined && element.label != undefined && element.is_image == undefined){
			innerHtml = get_base_btn_html(element.url, element.label, "light-blue") + close_html;
			value = element;
		}
		else if(element.is_image != undefined){
			if(element.is_image == true){
				innerHtml = get_base_array_image_html(element.url) + close_html;
			}
			else{
				innerHtml = get_base_array_link_html(element.url, arrayItem.visible_name) + close_html;
			}
			value = element;
		}
		else{
			log.warn("toto");
		}
	}
	else{
		innerHtml = element + close_html;
		value = element;
	}
	return {innerHtml: innerHtml, value: value};
}